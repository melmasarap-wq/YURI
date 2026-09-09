require("dotenv").config();

const fs = require("fs");
const path = require("path");

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
const ffmpegPath = require("ffmpeg-static");

const PREFIX = "!";
const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";

let ytDlp = null;


// =========================================================
// YOUTUBE COOKIES
// =========================================================

const cookiesPath = path.join(
    "/tmp",
    "youtube-cookies.txt"
);


function getYouTubeCookieKeys() {

    return Object.keys(process.env)
        .filter(function (key) {
            return /^YOUTUBE_COOKIES_\d+$/.test(key);
        })
        .sort(function (a, b) {

            const numberA =
                parseInt(a.split("_").pop(), 10);

            const numberB =
                parseInt(b.split("_").pop(), 10);

            return numberA - numberB;

        });

}


function getYouTubeCookies() {

    const cookieKeys =
        getYouTubeCookieKeys();


    if (cookieKeys.length > 0) {

        return cookieKeys
            .map(function (key) {
                return process.env[key] || "";
            })
            .join("");

    }


    return process.env.YOUTUBE_COOKIES || "";

}


function setupYouTubeCookies() {

    const cookies =
        getYouTubeCookies();


    const cookieKeys =
        getYouTubeCookieKeys();


    if (!cookies) {

        console.log(
            "No YouTube cookies found. Continuing without cookies."
        );

        return null;

    }


    try {

        fs.writeFileSync(
            cookiesPath,
            cookies,
            {
                encoding: "utf8",
                mode: 0o600
            }
        );


        if (cookieKeys.length > 0) {

            console.log(
                "YouTube cookies loaded from " +
                cookieKeys.length +
                " variable(s)."
            );

        } else {

            console.log(
                "YouTube cookies loaded."
            );

        }


        console.log(
            "YouTube cookie data length:",
            cookies.length
        );


        return cookiesPath;

    } catch (error) {

        console.error(
            "Failed to create YouTube cookies file:",
            error.message
        );

        return null;

    }

}


// =========================================================
// YT-DLP COMMON ARGUMENTS
// =========================================================

function getYtDlpCommonArgs() {

    const args = [

        "--no-warnings",

        "--no-progress",

        "--no-playlist",

        "--extractor-args",
        "youtube:player_client=default,-tv_downgraded,web_embedded"

    ];


    const nodeMajor =
        parseInt(
            process.versions.node.split(".")[0],
            10
        );


    if (
        !isNaN(nodeMajor) &&
        nodeMajor >= 22
    ) {

        args.push(
            "--js-runtimes",
            "node"
        );


        args.push(
            "--remote-components",
            "ejs:github"
        );


        console.log(
            "yt-dlp JavaScript runtime: Node " +
            process.versions.node
        );

    } else {

        console.log(
            "Warning: Node " +
            process.versions.node +
            " is below Node 22."
        );


        console.log(
            "YouTube extraction may require Deno or Node 22+."
        );

    }


    return args;

}


// =========================================================
// MULTI-SERVER MUSIC SYSTEM
// =========================================================

const guildMusic = new Map();


function getGuildMusic(guildId) {

    if (!guildMusic.has(guildId)) {

        const player =
            createAudioPlayer();


        player.on(
            AudioPlayerStatus.Playing,
            function () {

                console.log(
                    "Audio player is playing in guild " +
                    guildId
                );

            }
        );


        player.on(
            AudioPlayerStatus.Idle,
            function () {

                console.log(
                    "Audio player is idle in guild " +
                    guildId
                );

            }
        );


        player.on(
            "error",
            function (error) {

                console.error(
                    "Audio player error in guild " +
                    guildId +
                    ":",
                    error.message
                );

            }
        );


        guildMusic.set(
            guildId,
            {
                player: player,
                connection: null,

                // Contains both yt-dlp and FFmpeg
                currentProcess: null,

                playbackId: 0
            }
        );

    }


    return guildMusic.get(guildId);

}


// =========================================================
// CHECK DISCORD TOKEN
// =========================================================

if (!process.env.TOKEN) {

    console.error(
        "TOKEN is missing!"
    );

    process.exit(1);

}


console.log(
    "TOKEN found."
);


// =========================================================
// CHECK FFMPEG
// =========================================================

if (!ffmpegPath) {

    console.error(
        "FFmpeg was not found."
    );

    console.error(
        "Make sure ffmpeg-static is installed."
    );

    process.exit(1);

}


console.log(
    "FFmpeg path:",
    ffmpegPath
);


// =========================================================
// DISCORD CLIENT
// =========================================================

const client =
    new Client({

        intents: [

            GatewayIntentBits.Guilds,

            GatewayIntentBits.GuildMessages,

            GatewayIntentBits.MessageContent,

            GatewayIntentBits.GuildVoiceStates

        ]

    });


// =========================================================
// STOP AUDIO FOR ONE SERVER
// =========================================================

function stopCurrentAudio(guildId) {

    const music =
        getGuildMusic(guildId);


    console.log(
        "Stopping current audio in guild " +
        guildId +
        "..."
    );


    if (music.currentProcess) {

        try {

            music.currentProcess.kill();

        } catch (error) {

            console.log(
                "Could not kill current audio processes."
            );

        }


        music.currentProcess =
            null;

    }


    try {

        music.player.stop(true);

    } catch (error) {

        console.log(
            "Could not stop audio player."
        );

    }

}


// =========================================================
// SETUP YT-DLP
// =========================================================

async function setupYtDlp() {

    console.log(
        "Setting up yt-dlp..."
    );


    setupYouTubeCookies();


    ytDlp =
        new YTDlpWrap(
            ytDlpPath
        );


    try {

        const version =
            await ytDlp.execPromise([
                "--version"
            ]);


        console.log(
            "yt-dlp is ready. Version:",
            String(version).trim()
        );


        console.log(
            "Node.js version:",
            process.versions.node
        );


        console.log(
            "FFmpeg is ready."
        );

    } catch (error) {

        console.error(
            "yt-dlp is not working."
        );


        console.error(
            error
        );


        process.exit(1);

    }

}


// =========================================================
// SEARCH YOUTUBE
// =========================================================

async function searchYouTube(query) {

    console.log(
        "Searching YouTube for: " +
        query
    );


    try {

        const searchArgs =
            getYtDlpCommonArgs();


        searchArgs.push(

            "--dump-single-json",

            "--flat-playlist",

            "--skip-download",

            "ytsearch1:" + query

        );


        if (getYouTubeCookies()) {

            searchArgs.push(
                "--cookies",
                cookiesPath
            );

        }


        const output =
            await ytDlp.execPromise(
                searchArgs
            );


        const data =
            JSON.parse(
                String(output)
            );


        if (
            !data ||
            !data.entries ||
            data.entries.length === 0
        ) {

            return null;

        }


        const video =
            data.entries[0];


        if (!video.id) {

            return null;

        }


        return {

            id: video.id,

            title:
                video.title ||
                "Unknown title",

            url:
                "https://www.youtube.com/watch?v=" +
                video.id

        };

    } catch (error) {

        console.error(
            "YouTube search error:",
            error.message
        );


        return null;

    }

}


// =========================================================
// START AUDIO STREAM
//
// PIPELINE:
//
// YouTube
//    ↓
// yt-dlp
//    ↓
// FFmpeg
//    ↓
// Raw PCM 48kHz Stereo
//    ↓
// Discord
// =========================================================

function getAudioStream(
    url,
    guildId,
    thisPlayback
) {

    return new Promise(
        function (resolve, reject) {

            const music =
                getGuildMusic(guildId);


            if (
                thisPlayback !==
                music.playbackId
            ) {

                reject(
                    new Error(
                        "Playback request was replaced."
                    )
                );

                return;

            }


            console.log(
                "Starting audio stream for guild " +
                guildId +
                "..."
            );


            // =================================================
            // YT-DLP
            // =================================================

            let audioArgs =
                getYtDlpCommonArgs();


            audioArgs.push(

                "-f",
                "bestaudio/best",

                "-o",
                "-"

            );


            if (getYouTubeCookies()) {

                audioArgs.push(
                    "--cookies",
                    cookiesPath
                );

            }


            audioArgs.push(
                url
            );


            let ytProcess;


            try {

                ytProcess =
                    spawn(
                        ytDlpPath,
                        audioArgs,
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


            if (!ytProcess.stdout) {

                try {

                    ytProcess.kill(
                        "SIGKILL"
                    );

                } catch (error) {}


                reject(
                    new Error(
                        "yt-dlp could not create an audio stream."
                    )
                );

                return;

            }


            // =================================================
            // FFMPEG
            // =================================================

            let ffmpegProcess;


            try {

                ffmpegProcess =
                    spawn(
                        ffmpegPath,
                        [

                            "-hide_banner",

                            "-loglevel",
                            "error",

                            "-i",
                            "pipe:0",

                            "-vn",

                            "-f",
                            "s16le",

                            "-ar",
                            "48000",

                            "-ac",
                            "2",

                            "pipe:1"

                        ],
                        {
                            stdio: [
                                "pipe",
                                "pipe",
                                "pipe"
                            ]
                        }
                    );

            } catch (error) {

                try {

                    ytProcess.kill(
                        "SIGKILL"
                    );

                } catch (err) {}


                reject(error);

                return;

            }


            if (!ffmpegProcess.stdout) {

                try {

                    ytProcess.kill(
                        "SIGKILL"
                    );

                } catch (error) {}


                try {

                    ffmpegProcess.kill(
                        "SIGKILL"
                    );

                } catch (error) {}


                reject(
                    new Error(
                        "FFmpeg could not create an audio stream."
                    )
                );

                return;

            }


            // =================================================
            // CURRENT PROCESS
            // =================================================

            const processController = {

                ytProcess:
                    ytProcess,

                ffmpegProcess:
                    ffmpegProcess,

                kill:
                    function () {

                        try {

                            ytProcess.kill(
                                "SIGKILL"
                            );

                        } catch (error) {}


                        try {

                            ffmpegProcess.kill(
                                "SIGKILL"
                            );

                        } catch (error) {}

                    }

            };


            music.currentProcess =
                processController;


            // =================================================
            // VARIABLES
            // =================================================

            let stderr = "";

            let ffmpegStderr = "";

            let settled = false;

            let receivedYtAudio =
                false;

            let receivedPcm =
                false;


            // =================================================
            // SAFE ERROR HANDLERS
            //
            // Prevent EPIPE / broken pipe errors from
            // becoming unhandled Node.js errors.
            // =================================================

            ytProcess.stdout.on(
                "error",
                function (error) {

                    console.log(
                        "yt-dlp stdout closed:",
                        error.message
                    );

                }
            );


            ffmpegProcess.stdin.on(
                "error",
                function (error) {

                    console.log(
                        "FFmpeg stdin closed:",
                        error.message
                    );

                }
            );


            ffmpegProcess.stdout.on(
                "error",
                function (error) {

                    console.log(
                        "FFmpeg stdout closed:",
                        error.message
                    );

                }
            );


            // =================================================
            // PIPE YT-DLP → FFMPEG
            // =================================================

            ytProcess.stdout.pipe(
                ffmpegProcess.stdin
            );


            // =================================================
            // YT-DLP STDERR
            // =================================================

            ytProcess.stderr.on(
                "data",
                function (data) {

                    const text =
                        data.toString();


                    stderr += text;


                    if (
                        text.includes("ERROR") ||
                        text.includes("WARNING")
                    ) {

                        console.error(
                            text.trim()
                        );

                    }

                }
            );


            // =================================================
            // FFMPEG STDERR
            // =================================================

            ffmpegProcess.stderr.on(
                "data",
                function (data) {

                    const text =
                        data.toString();


                    ffmpegStderr += text;


                    console.error(
                        "FFmpeg:",
                        text.trim()
                    );

                }
            );


            // =================================================
            // FFMPEG AUDIO DATA
            // =================================================

            ffmpegProcess.stdout.once(
                "data",
                function (chunk) {

                    if (
                        !chunk ||
                        chunk.length === 0
                    ) {

                        return;

                    }


                    receivedPcm =
                        true;


                    console.log(
                        "FFmpeg started sending PCM audio in guild " +
                        guildId
                    );


                    if (
                        thisPlayback !==
                        music.playbackId
                    ) {

                        processController.kill();


                        if (!settled) {

                            settled = true;


                            reject(
                                new Error(
                                    "Playback request was replaced."
                                )
                            );

                        }


                        return;

                    }


                    if (!settled) {

                        settled = true;


                        resolve({

                            process:
                                processController,

                            stream:
                                ffmpegProcess.stdout

                        });

                    }

                }
            );


            // =================================================
            // YT-DLP PROCESS ERROR
            // =================================================

            ytProcess.on(
                "error",
                function (error) {

                    console.error(
                        "yt-dlp process error:",
                        error.message
                    );


                    if (
                        music.currentProcess ===
                        processController
                    ) {

                        music.currentProcess =
                            null;

                    }


                    if (settled) {

                        return;

                    }


                    settled = true;


                    reject(error);

                }
            );


            // =================================================
            // FFMPEG PROCESS ERROR
            // =================================================

            ffmpegProcess.on(
                "error",
                function (error) {

                    console.error(
                        "FFmpeg process error:",
                        error.message
                    );


                    if (
                        music.currentProcess ===
                        processController
                    ) {

                        music.currentProcess =
                            null;

                    }


                    if (settled) {

                        return;

                    }


                    settled = true;


                    reject(
                        new Error(
                            "FFmpeg failed: " +
                            error.message
                        )
                    );

                }
            );


            // =================================================
            // YT-DLP CLOSE
            // =================================================

            ytProcess.on(
                "close",
                function (code) {

                    receivedYtAudio =
                        receivedYtAudio ||
                        receivedPcm;


                    console.log(
                        "yt-dlp process closed with code " +
                        code +
                        " in guild " +
                        guildId
                    );


                    console.log(
                        "yt-dlp produced audio:",
                        receivedYtAudio
                    );


                    // Do not immediately reject if FFmpeg
                    // is still processing buffered data.
                    if (
                        !receivedPcm &&
                        !settled &&
                        thisPlayback ===
                        music.playbackId
                    ) {

                        // Give FFmpeg a moment to report
                        // an actual error/output.
                        setTimeout(
                            function () {

                                if (
                                    settled ||
                                    receivedPcm
                                ) {

                                    return;

                                }


                                if (
                                    thisPlayback !==
                                    music.playbackId
                                ) {

                                    return;

                                }


                                settled = true;


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
                                            "YouTube blocked playback from the Railway server."
                                        )
                                    );

                                    return;

                                }


                                if (
                                    stderr.includes(
                                        "The page needs to be reloaded"
                                    )
                                ) {

                                    reject(
                                        new Error(
                                            "YouTube rejected the current client. yt-dlp/EJS or the JavaScript runtime needs updating."
                                        )
                                    );

                                    return;

                                }


                                if (
                                    stderr.includes(
                                        "Requested format is not available"
                                    )
                                ) {

                                    reject(
                                        new Error(
                                            "YouTube did not provide a usable audio format."
                                        )
                                    );

                                    return;

                                }


                                if (
                                    stderr.includes(
                                        "PO Token"
                                    )
                                ) {

                                    reject(
                                        new Error(
                                            "YouTube requires a PO Token for this video."
                                        )
                                    );

                                    return;

                                }


                                if (
                                    stderr.includes(
                                        "No supported JavaScript runtime"
                                    )
                                ) {

                                    reject(
                                        new Error(
                                            "yt-dlp cannot find a supported JavaScript runtime."
                                        )
                                    );

                                    return;

                                }


                                if (ffmpegStderr.trim()) {

                                    reject(
                                        new Error(
                                            "FFmpeg could not process the audio: " +
                                            ffmpegStderr.trim()
                                        )
                                    );

                                    return;

                                }


                                reject(
                                    new Error(
                                        "yt-dlp exited with code " +
                                        code +
                                        " before producing audio."
                                    )
                                );

                            },
                            1000
                        );

                    }

                }
            );


            // =================================================
            // FFMPEG CLOSE
            // =================================================

            ffmpegProcess.on(
                "close",
                function (code) {

                    console.log(
                        "FFmpeg process closed with code " +
                        code +
                        " in guild " +
                        guildId
                    );


                    if (
                        music.currentProcess ===
                        processController
                    ) {

                        music.currentProcess =
                            null;

                    }


                    if (
                        !receivedPcm &&
                        !settled &&
                        thisPlayback ===
                        music.playbackId
                    ) {

                        settled = true;


                        if (ffmpegStderr.trim()) {

                            reject(
                                new Error(
                                    "FFmpeg could not process the audio: " +
                                    ffmpegStderr.trim()
                                )
                            );

                        } else {

                            reject(
                                new Error(
                                    "FFmpeg exited with code " +
                                    code +
                                    " before producing audio."
                                )
                            );

                        }

                    }

                }
            );

        }
    );

}


// =========================================================
// DISCORD READY
// =========================================================

client.once(
    "clientReady",
    function () {

        console.log(
            "Logged in as " +
            client.user.tag +
            "!"
        );


        console.log(
            "Bot is ready."
        );


        client.user.setActivity(
            "!help",
            {
                type:
                    ActivityType.Listening
            }
        );

    }
);


// =========================================================
// MESSAGE HANDLER
// =========================================================

client.on(
    "messageCreate",
    async function (message) {

        if (
            message.author.bot
        ) {

            return;

        }


        if (
            !message.content.startsWith(
                PREFIX
            )
        ) {

            return;

        }


        const args =
            message.content
                .slice(PREFIX.length)
                .trim()
                .split(/\s+/);


        const command =
            args.shift();


        if (!command) {

            return;

        }


        const lowerCommand =
            command.toLowerCase();


        if (!message.guild) {

            return;

        }


        const guildId =
            message.guild.id;


        const music =
            getGuildMusic(guildId);


        // =====================================================
        // HELLO
        // =====================================================

        if (
            lowerCommand === "hello"
        ) {

            await message.reply(
                "ano na naman kailangan mo?"
            );

            return;

        }


        // =====================================================
        // PING
        // =====================================================

        if (
            lowerCommand === "ping"
        ) {

            await message.reply(
                "Pong! " +
                client.ws.ping +
                "ms"
            );

            return;

        }


        // =====================================================
        // JOIN
        // =====================================================

        if (
            lowerCommand === "join"
        ) {

            const voiceChannel =
                message.member &&
                message.member.voice &&
                message.member.voice.channel;


            if (!voiceChannel) {

                await message.reply(
                    "You need to join a voice channel first."
                );

                return;

            }


            try {

                if (
                    music.connection
                ) {

                    try {

                        music.connection.destroy();

                    } catch (error) {}

                }


                const connection =
                    joinVoiceChannel({

                        channelId:
                            voiceChannel.id,

                        guildId:
                            voiceChannel.guild.id,

                        adapterCreator:
                            voiceChannel.guild
                                .voiceAdapterCreator,

                        selfDeaf:
                            true

                    });


                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    30000
                );


                connection.subscribe(
                    music.player
                );


                music.connection =
                    connection;


                await message.reply(
                    "Joined " +
                    voiceChannel.name +
                    "."
                );

            } catch (error) {

                console.error(
                    "Join error:",
                    error
                );


                await message.reply(
                    "I couldn't join the voice channel."
                );

            }

            return;

        }


        // =====================================================
        // PLAY
        // =====================================================

        if (
            lowerCommand === "play"
        ) {

            const query =
                args.join(" ");


            if (!query) {

                await message.reply(
                    "Usage: !play song name"
                );

                return;

            }


            const voiceChannel =
                message.member &&
                message.member.voice &&
                message.member.voice.channel;


            if (!voiceChannel) {

                await message.reply(
                    "You need to join a voice channel first."
                );

                return;

            }


            music.playbackId++;


            const thisPlayback =
                music.playbackId;


            console.log(
                "New playback request #" +
                thisPlayback +
                " in guild " +
                guildId +
                ": " +
                query
            );


            stopCurrentAudio(
                guildId
            );


            let searchingMessage =
                null;


            try {

                searchingMessage =
                    await message.reply(
                        "Searching for " +
                        query +
                        "..."
                    );


                // -------------------------------------------------
                // SEARCH
                // -------------------------------------------------

                const video =
                    await searchYouTube(
                        query
                    );


                if (
                    thisPlayback !==
                    music.playbackId
                ) {

                    return;

                }


                if (!video) {

                    await searchingMessage.edit(
                        "I couldn't find that song."
                    );

                    return;

                }


                console.log(
                    "Found: " +
                    video.title
                );


                // -------------------------------------------------
                // VOICE CONNECTION
                // -------------------------------------------------

                if (
                    !music.connection ||
                    music.connection.state.status !==
                    VoiceConnectionStatus.Ready
                ) {

                    try {

                        music.connection =
                            joinVoiceChannel({

                                channelId:
                                    voiceChannel.id,

                                guildId:
                                    voiceChannel.guild.id,

                                adapterCreator:
                                    voiceChannel.guild
                                        .voiceAdapterCreator,

                                selfDeaf:
                                    true

                            });


                        await entersState(
                            music.connection,
                            VoiceConnectionStatus.Ready,
                            30000
                        );


                        music.connection.subscribe(
                            music.player
                        );

                    } catch (error) {

                        if (
                            thisPlayback !==
                            music.playbackId
                        ) {

                            return;

                        }


                        console.error(
                            "Voice connection error:",
                            error
                        );


                        await searchingMessage.edit(
                            "I couldn't connect to the voice channel."
                        );


                        return;

                    }

                }


                // -------------------------------------------------
                // AUDIO
                // -------------------------------------------------

                let audio;


                try {

                    audio =
                        await getAudioStream(
                            video.url,
                            guildId,
                            thisPlayback
                        );

                } catch (error) {

                    if (
                        thisPlayback !==
                        music.playbackId
                    ) {

                        return;

                    }


                    console.error(
                        "Audio error:",
                        error.message
                    );


                    await searchingMessage.edit(
                        "I couldn't play this song.\n\n" +
                        "Reason: " +
                        error.message
                    );


                    return;

                }


                // -------------------------------------------------
                // PLAYBACK CHECK
                // -------------------------------------------------

                if (
                    thisPlayback !==
                    music.playbackId
                ) {

                    try {

                        audio.process.kill();

                    } catch (error) {}


                    return;

                }


                // -------------------------------------------------
                // CREATE RAW PCM AUDIO RESOURCE
                // -------------------------------------------------

                let resource;


                try {

                    resource =
                        createAudioResource(
                            audio.stream,
                            {
                                inputType:
                                    StreamType.Raw,

                                inlineVolume:
                                    false
                            }
                        );

                } catch (error) {

                    try {

                        audio.process.kill();

                    } catch (err) {}


                    throw error;

                }


                // -------------------------------------------------
                // FINAL CHECK
                // -------------------------------------------------

                if (
                    thisPlayback !==
                    music.playbackId
                ) {

                    try {

                        audio.process.kill();

                    } catch (error) {}


                    return;

                }


                // -------------------------------------------------
                // PLAY
                // -------------------------------------------------

                music.player.play(
                    resource
                );


                await searchingMessage.edit(
                    "Now playing: " +
                    video.title
                );


                console.log(
                    "Playing playback #" +
                    thisPlayback +
                    " in guild " +
                    guildId +
                    ": " +
                    video.title
                );

            } catch (error) {

                if (
                    thisPlayback !==
                    music.playbackId
                ) {

                    return;

                }


                console.error(
                    "Play command error:",
                    error
                );


                try {

                    if (
                        searchingMessage
                    ) {

                        await searchingMessage.edit(
                            "Something went wrong while playing the song."
                        );

                    } else {

                        await message.reply(
                            "Something went wrong while playing the song."
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


        // =====================================================
        // STOP
        // =====================================================

        if (
            lowerCommand === "stop"
        ) {

            music.playbackId++;


            stopCurrentAudio(
                guildId
            );


            await message.reply(
                "Stopped the music."
            );


            return;

        }


        // =====================================================
        // LEAVE
        // =====================================================

        if (
            lowerCommand === "leave"
        ) {

            music.playbackId++;


            stopCurrentAudio(
                guildId
            );


            if (
                music.connection
            ) {

                try {

                    music.connection.destroy();

                } catch (error) {

                    console.error(
                        "Leave error:",
                        error
                    );

                }


                music.connection =
                    null;

            }


            await message.reply(
                "Left the voice channel."
            );


            return;

        }


        // =====================================================
        // HELP
        // =====================================================

        if (
            lowerCommand === "help"
        ) {

            await message.reply(

                [

                    "YURI BOT COMMANDS",

                    "",

                    "!play <song> - Play a song",

                    "!stop - Stop music",

                    "!join - Join your voice channel",

                    "!leave - Leave voice channel",

                    "!ping - Check bot latency",

                    "!hello - Say hello",

                    "!help - Show commands"

                ].join("\n")

            );


            return;

        }

    }
);


// =========================================================
// START BOT
// =========================================================

async function startBot() {

    try {

        await setupYtDlp();


        console.log(
            "Logging into Discord..."
        );


        await client.login(
            process.env.TOKEN
        );


        console.log(
            "Discord login successful."
        );

    } catch (error) {

        console.error(
            "Failed to start bot:",
            error
        );


        process.exit(1);

    }

}


startBot();
