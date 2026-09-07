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

const PREFIX = "!";

const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";
let ytDlp;

let currentProcess = null;
let currentGuildId = null;

// This prevents old !play requests from taking control again.
let playbackId = 0;

if (!process.env.TOKEN) {
    console.error("❌ TOKEN is missing!");
    process.exit(1);
}

console.log("TOKEN found.");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const player = createAudioPlayer();

/* =========================================================
   STOP CURRENT AUDIO
========================================================= */

function stopCurrentAudio() {
    console.log("Stopping current audio...");

    if (currentProcess) {
        try {
            currentProcess.kill("SIGKILL");
        } catch (err) {
            console.log("Could not kill old yt-dlp process.");
        }

        currentProcess = null;
    }

    try {
        player.stop(true);
    } catch (err) {
        console.log("Could not stop audio player.");
    }
}

/* =========================================================
   PLAYER EVENTS
========================================================= */

player.on(AudioPlayerStatus.Playing, () => {
    console.log("▶️ Audio player is playing.");
});

player.on(AudioPlayerStatus.Idle, () => {
    console.log("⏹️ Audio player became idle.");
    
    // IMPORTANT:
    // Do NOT kill currentProcess here.
    // A new playback may already have started.
});

player.on("error", error => {
    console.error("❌ Audio player error:", error.message);
});

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
    console.log(`🔎 Searching YouTube for: ${query}`);

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

        if (!data || !data.entries || data.entries.length === 0) {
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
        console.error("❌ YouTube search error:", error.message);
        return null;
    }
}

/* =========================================================
   GET AUDIO STREAM
========================================================= */

function getAudioStream(url, thisPlayback) {
    return new Promise((resolve, reject) => {

        if (thisPlayback !== playbackId) {
            reject(new Error("Playback request was replaced."));
            return;
        }

        console.log("Starting audio stream...");

        let process;

        try {
            process = ytDlp.exec([
                "-f",
                "bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio",

                "--no-playlist",
                "--no-warnings",
                "--no-progress",

                "-o",
                "-",

                url
            ]);
        } catch (error) {
            reject(error);
            return;
        }

        if (!process || !process.stdout) {
            reject(
                new Error(
                    "yt-dlp did not provide stdout."
                )
            );
            return;
        }

        currentProcess = process;

        let stderr = "";

        process.stderr.on("data", data => {
            const text = data.toString();

            stderr += text;

            // Keep Railway logs useful without flooding them.
            if (
                text.includes("ERROR") ||
                text.includes("WARNING")
            ) {
                console.error(text.trim());
            }
        });

        process.on("error", error => {

            if (currentProcess === process) {
                currentProcess = null;
            }

            if (thisPlayback !== playbackId) {
                reject(
                    new Error("Playback request was replaced.")
                );
                return;
            }

            console.error(
                "❌ yt-dlp process error:",
                error.message
            );

            reject(error);
        });

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

            if (code !== 0) {

                if (
                    stderr.includes(
                        "Sign in to confirm you're not a bot"
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

        resolve({
            process,
            stream: process.stdout
        });
    });
}

/* =========================================================
   BOT READY
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
   MESSAGES
========================================================= */

client.on("messageCreate", async message => {

    if (message.author.bot) return;

    if (!message.content.startsWith(PREFIX)) return;

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

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator:
                    voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                30_000
            );

            connection.subscribe(player);

            currentGuildId = voiceChannel.guild.id;

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

        // NEW PLAYBACK REQUEST
        playbackId++;

        const thisPlayback = playbackId;

        console.log(
            `New playback request #${thisPlayback}: ${query}`
        );

        // Stop previous audio/process immediately.
        stopCurrentAudio();

        let searchingMessage;

        try {

            searchingMessage = await message.reply(
                `🔎 Searching for **${query}**...`
            );

            /* =============================================
               SEARCH
            ============================================= */

            const video = await searchYouTube(query);

            // Another !play happened while searching.
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
               JOIN VOICE
            ============================================= */

            let connection;

            try {

                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator:
                        voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: true
                });

                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    30_000
                );

                connection.subscribe(player);

                currentGuildId = voiceChannel.guild.id;

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

            /* =============================================
               AUDIO STREAM
            ============================================= */

            let audio;

            try {

                audio = await getAudioStream(
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

                if (
                    error.message.includes(
                        "YouTube blocked audio playback"
                    )
                ) {

                    await searchingMessage.edit(
                        "❌ YouTube blocked audio playback from the Railway server.\n" +
                        "The bot is working, but YouTube is refusing the audio request."
                    );

                } else {

                    await searchingMessage.edit(
                        `❌ Couldn't play this song.\n\`${error.message}\``
                    );
                }

                return;
            }

            /* =============================================
               CHECK AGAIN BEFORE PLAYING
            ============================================= */

            if (thisPlayback !== playbackId) {

                try {
                    audio.process.kill("SIGKILL");
                } catch (err) {}

                return;
            }

            /* =============================================
               CREATE AUDIO RESOURCE
            ============================================= */

            const resource = createAudioResource(
                audio.stream,
                {
                    inputType: StreamType.WebmOpus,
                    inlineVolume: false
                }
            );

            /* =============================================
               FINAL CHECK
            ============================================= */

            if (thisPlayback !== playbackId) {

                try {
                    audio.process.kill("SIGKILL");
                } catch (err) {}

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

            // Clean up when this specific process ends.
            audio.process.on("close", () => {

                if (currentProcess === audio.process) {
                    currentProcess = null;
                }

            });

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
                        "❌ Something went wrong while trying to play the song."
                    );
                } else {
                    await message.reply(
                        "❌ Something went wrong while trying to play the song."
                    );
                }

            } catch (editError) {
                console.error(
                    "Could not send error message:",
                    editError
                );
            }
        }

        return;
    }

    /* =====================================================
       STOP
    ===================================================== */

    if (command === "stop") {

        // Invalidate every previous play request.
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

        // Invalidate old playback requests.
        playbackId++;

        stopCurrentAudio();

        const guild =
            message.guild;

        if (!guild) {
            return;
        }

        const connection =
            guild.voiceStates.cache.get(
                client.user.id
            )?.channel;

        if (connection) {

            try {

                const voiceConnection =
                    joinVoiceChannel({
                        channelId: connection.id,
                        guildId: guild.id,
                        adapterCreator:
                            guild.voiceAdapterCreator
                    });

                voiceConnection.destroy();

            } catch (error) {

                console.error(
                    "Leave error:",
                    error
                );
            }
        }

        currentGuildId = null;

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
   LOGIN
========================================================= */

async function startBot() {

    try {

        await setupYtDlp();

        console.log("Logging into Discord...");

        await client.login(process.env.TOKEN);

        console.log("Discord login successful.");

    } catch (error) {

        console.error(
            "❌ Failed to start bot:",
            error
        );

        process.exit(1);
    }
}

startBot();
