```js
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ActivityType
} = require("discord.js");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType,
    entersState
} = require("@discordjs/voice");

const YTDlpWrap = require("yt-dlp-wrap").default;
const { spawn } = require("child_process");

const PREFIX = "!";

const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";

let ytDlp;
let currentProcess = null;
let currentConnection = null;

// Prevent old !play commands from taking over
let playbackId = 0;

/* =========================================================
   CHECK TOKEN
========================================================= */

if (!process.env.TOKEN) {
    console.error("❌ TOKEN is missing!");
    process.exit(1);
}

console.log("TOKEN found.");

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

/* =========================================================
   AUDIO PLAYER
========================================================= */

const player = createAudioPlayer();

/* =========================================================
   PLAYER EVENTS
========================================================= */

player.on(AudioPlayerStatus.Playing, () => {
    console.log("▶️ Audio player is playing.");
});

player.on(AudioPlayerStatus.Idle, () => {
    console.log("⏹️ Audio player is idle.");

    // DO NOT kill currentProcess here.
    // A new !play may already be running.
});

player.on("error", error => {
    console.error("❌ Audio player error:", error.message);
});

/* =========================================================
   STOP CURRENT AUDIO
========================================================= */

function stopCurrentAudio() {
    console.log("Stopping current audio...");

    if (currentProcess) {
        try {
            currentProcess.kill("SIGKILL");
        } catch (error) {
            console.log("Could not kill old yt-dlp process.");
        }

        currentProcess = null;
    }

    try {
        player.stop(true);
    } catch (error) {
        console.log("Could not stop audio player.");
    }
}

/* =========================================================
   SETUP YT-DLP
========================================================= */

async function setupYtDlp() {
    console.log("Setting up yt-dlp...");

    ytDlp = new YTDlpWrap(ytDlpPath);

    try {
        const version = await ytDlp.execPromise([
            "--version"
        ]);

        console.log(
            "yt-dlp is ready. Version:",
            String(version).trim()
        );

    } catch (error) {

        console.error("❌ yt-dlp is not working.");
        console.error(error);

        process.exit(1);
    }
}

/* =========================================================
   SEARCH YOUTUBE
========================================================= */

async function searchYouTube(query) {

    console.log("Searching YouTube for: " + query);

    try {

        const output = await ytDlp.execPromise([
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--no-playlist",
            "--skip-download",
            "ytsearch1:" + query
        ]);

        const data = JSON.parse(String(output));

        if (
            !data ||
            !data.entries ||
            data.entries.length === 0
        ) {
            return null;
        }

        const video = data.entries[0];

        if (!video.id) {
            return null;
        }

        return {
            id: video.id,
            title: video.title || "Unknown title",
            url: `https://www.youtube.com/watch?v=${video.id}`
        };

    } catch (error) {

        console.error(
            "❌ YouTube search error:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   START AUDIO STREAM
========================================================= */

function getAudioStream(url, thisPlayback) {

    return new Promise((resolve, reject) => {

        if (thisPlayback !== playbackId) {
            reject(
                new Error("Playback request was replaced.")
            );
            return;
        }

        console.log("Starting audio stream...");

        let process;

        try {

            process = spawn(
                ytDlpPath,
                [
                    "-f",
                    "bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio",

                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",

                    "-o",
                    "-",

                    url
                ],
                {
                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]
                }
            );

        } catch (error) {

            reject(error);
            return;
        }

        if (!process.stdout) {

            try {
                process.kill("SIGKILL");
            } catch (error) {}

            reject(
                new Error(
                    "yt-dlp could not create an audio stream."
                )
            );

            return;
        }

        currentProcess = process;

        let stderr = "";
        let finished = false;

        /* =================================================
           STDERR
        ================================================= */

        process.stderr.on("data", data => {

            const text = data.toString();

            stderr += text;

            if (
                text.includes("ERROR") ||
                text.includes("WARNING")
            ) {
                console.error(text.trim());
            }
        });

        /* =================================================
           PROCESS ERROR
        ================================================= */

        process.on("error", error => {

            console.error(
                "❌ yt-dlp process error:",
                error.message
            );

            if (currentProcess === process) {
                currentProcess = null;
            }

            if (finished) {
                return;
            }

            finished = true;

            if (thisPlayback !== playbackId) {
                reject(
                    new Error(
                        "Playback request was replaced."
                    )
                );
                return;
            }

            reject(error);
        });

        /* =================================================
           PROCESS CLOSE
        ================================================= */

        process.on("close", code => {

            if (currentProcess === process) {
                currentProcess = null;
            }

            console.log(
                `yt-dlp process closed with code ${code}`
            );

            if (thisPlayback !== playbackId) {
                return;
            }

            if (finished) {
                return;
            }

            if (code !== 0) {

                finished = true;

                if (
                    stderr.includes(
                        "Sign in to confirm"
                    ) ||
                    stderr.includes(
                        "not a bot"
                    )
                ) {

                    reject(
                        new Error(
                            "YouTube blocked audio playback from the Railway server."
                        )
                    );

                    return;
                }

                reject(
                    new Error(
                        `yt-dlp exited with code ${code}.`
                    )
                );
            }
        });

        /* =================================================
           RESOLVE STREAM
        ================================================= */

        resolve({
            process,
            stream: process.stdout
        });
    });
}

/* =========================================================
   DISCORD READY
========================================================= */

client.once("clientReady", () => {

    console.log(
        `Logged in as ${client.user.tag}!`
    );

    console.log("Bot is ready.");

    client.user.setActivity("!help", {
        type: ActivityType.Listening
    });
});

/* =========================================================
   MESSAGE HANDLER
========================================================= */

client.on("messageCreate", async message => {

    if (message.author.bot) {
        return;
    }

    if (!message.content.startsWith(PREFIX)) {
        return;
    }

    const args = message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command = args.shift()?.toLowerCase();

    /* =====================================================
       HELLO
    ===================================================== */

    if (command === "hello") {

        await message.reply(
            "Hello! I'm YURI BOT 👋"
        );

        return;
    }

    /* =====================================================
       PING
    ===================================================== */

    if (command === "ping") {

        await message.reply(
            `🏓 Pong! ${client.ws.ping}ms`
        );

        return;
    }

    /* =====================================================
       JOIN
    ===================================================== */

    if (command === "join") {

        const voiceChannel =
            message.member?.voice?.channel;

        if (!voiceChannel) {

            await message.reply(
                "❌ You need to join a voice channel first."
            );

            return;
        }

        try {

            if (currentConnection) {
                try {
                    currentConnection.destroy();
                } catch (error) {}
            }

            const connection =
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator:
                        voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: true
                });

            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                30000
            );

            connection.subscribe(player);

            currentConnection = connection;

            await message.reply(
                `✅ Joined **${voiceChannel.name}**.`
            );

        } catch (error) {

            console.error(
                "❌ Join error:",
                error
            );

            await message.reply(
                "❌ I couldn't join the voice channel."
            );
        }

        return;
    }

    /* =====================================================
       PLAY
    ===================================================== */

    if (command === "play") {

        const query = args.join(" ");

        if (!query) {

            await message.reply(
                "❌ Usage: `!play song name`"
            );

            return;
        }

        const voiceChannel =
            message.member?.voice?.channel;

        if (!voiceChannel) {

            await message.reply(
                "❌ You need to join a voice channel first."
            );

            return;
        }

        /* =================================================
           NEW PLAYBACK
        ================================================= */

        playbackId++;

        const thisPlayback = playbackId;

        console.log(
            `New playback request #${thisPlayback}: ${query}`
        );

        /* =================================================
           STOP OLD SONG
        ================================================= */

        stopCurrentAudio();

        let searchingMessage = null;

        try {

            searchingMessage =
                await message.reply(
                    `🔎 Searching for **${query}**...`
                );

            /* =============================================
               SEARCH
            ============================================= */

            const video =
                await searchYouTube(query);

            if (thisPlayback !== playbackId) {
                return;
            }

            if (!video) {

                await searchingMessage.edit(
                    "❌ I couldn't find that song."
                );

                return;
            }

            console.log(
                `Found: ${video.title}`
            );

            /* =============================================
               VOICE CONNECTION
            ============================================= */

            if (
                !currentConnection ||
                currentConnection.state.status !==
                    VoiceConnectionStatus.Ready
            ) {

                try {

                    currentConnection =
                        joinVoiceChannel({
                            channelId: voiceChannel.id,
                            guildId: voiceChannel.guild.id,
                            adapterCreator:
                                voiceChannel.guild.voiceAdapterCreator,
                            selfDeaf: true
                        });

                    await entersState(
                        currentConnection,
                        VoiceConnectionStatus.Ready,
                        30000
                    );

                    currentConnection.subscribe(player);

                } catch (error) {

                    if (thisPlayback !== playbackId) {
                        return;
                    }

                    console.error(
                        "❌ Voice connection error:",
                        error
                    );

                    await searchingMessage.edit(
                        "❌ I couldn't connect to the voice channel."
                    );

                    return;
                }
            }

            /* =============================================
               GET AUDIO
            ============================================= */

            let audio;

            try {

                audio =
                    await getAudioStream(
                        video.url,
                        thisPlayback
                    );

            } catch (error) {

                if (thisPlayback !== playbackId) {
                    return;
                }

                console.error(
                    "❌ Audio error:",
                    error.message
                );

                await searchingMessage.edit(
                    "❌ I couldn't play this song.\n\n" +
                    `**Reason:** ${error.message}`
                );

                return;
            }

            /* =============================================
               CHECK PLAYBACK ID
            ============================================= */

            if (thisPlayback !== playbackId) {

                try {
                    audio.process.kill("SIGKILL");
                } catch (error) {}

                return;
            }

            /* =============================================
               CREATE AUDIO RESOURCE
            ============================================= */

            let resource;

            try {

                resource =
                    createAudioResource(
                        audio.stream,
                        {
                            inputType:
                                StreamType.WebmOpus
                        }
                    );

            } catch (error) {

                try {
                    audio.process.kill("SIGKILL");
                } catch (err) {}

                throw error;
            }

            /* =============================================
               FINAL PLAYBACK CHECK
            ============================================= */

            if (thisPlayback !== playbackId) {

                try {
                    audio.process.kill("SIGKILL");
                } catch (error) {}

                return;
            }

            /* =============================================
               PLAY
            ============================================= */

            player.play(resource);

            await searchingMessage.edit(
                `🎵 Now playing: **${video.title}**`
            );

            console.log(
                `▶️ Playing playback #${thisPlayback}: ${video.title}`
            );

        } catch (error) {

            if (thisPlayback !== playbackId) {
                return;
            }

            console.error(
                "❌ Play command error:",
                error
            );

            try {

                if (searchingMessage) {

                    await searchingMessage.edit(
                        "❌ Something went wrong while playing the song."
                    );

                } else {

                    await message.reply(
                        "❌ Something went wrong while playing the song."
                    );
                }

            } catch (sendError) {

                console.error(
                    "Could not send error message:",
                    sendError
                );
            }
        }

        return;
    }

    /* =====================================================
       STOP
    ===================================================== */

    if (command === "stop") {

        playbackId++;

        stopCurrentAudio();

        await message.reply(
            "⏹️ Stopped the music."
        );

        return;
    }

    /* =====================================================
       LEAVE
    ===================================================== */

    if (command === "leave") {

        playbackId++;

        stopCurrentAudio();

        if (currentConnection) {

            try {
                currentConnection.destroy();
            } catch (error) {
                console.error(
                    "Leave error:",
                    error
                );
            }

            currentConnection = null;
        }

        await message.reply(
            "👋 Left the voice channel."
        );

        return;
    }

    /* =====================================================
       HELP
    ===================================================== */

    if (command === "help") {

        await message.reply(
            [
                "**🎵 YURI BOT COMMANDS**",
                "",
                "`!play <song>` - Play a song",
                "`!stop` - Stop music",
                "`!join` - Join your voice channel",
                "`!leave` - Leave voice channel",
                "`!ping` - Check bot latency",
                "`!hello` - Say hello",
                "`!help` - Show commands"
            ].join("\n")
        );

        return;
    }
});

/* =========================================================
   START BOT
========================================================= */

async function startBot() {

    try {

        await setupYtDlp();

        console.log("Logging into Discord...");

        await client.login(
            process.env.TOKEN
        );

        console.log(
            "Discord login successful."
        );

    } catch (error) {

        console.error(
            "❌ Failed to start bot:",
            error
        );

        process.exit(1);
    }
}

startBot();
```
