require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

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
const ffmpegPath = require("ffmpeg-static");

/* =========================================================
   CONFIG
========================================================= */

const PREFIX = "!";

const ytDlpPath =
    process.env.YTDLP_PATH || "yt-dlp";

const cookiesPath =
    path.join("/tmp", "youtube-cookies.txt");

/* =========================================================
   TOKEN CHECK
========================================================= */

if (!process.env.TOKEN) {
    console.error("ERROR: TOKEN is missing.");
    process.exit(1);
}

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
   YT-DLP
========================================================= */

let ytDlp = null;

/* =========================================================
   PER-SERVER MUSIC
========================================================= */

const guildMusic = new Map();

function getGuildMusic(guildId) {

    if (!guildMusic.has(guildId)) {

        const player =
            createAudioPlayer();

        const music = {

            player: player,

            connection: null,

            currentProcess: null,

            playbackId: 0,

            queue: [],

            currentTrack: null,

            isPlaying: false
        };

        /* =================================================
           PLAYER PLAYING
        ================================================= */

        player.on(
            AudioPlayerStatus.Playing,
            function () {

                music.isPlaying = true;

                console.log(
                    "Audio player is playing in guild " +
                    guildId
                );
            }
        );

        /* =================================================
           PLAYER IDLE
        ================================================= */

        player.on(
            AudioPlayerStatus.Idle,
            async function () {

                music.isPlaying = false;

                console.log(
                    "Audio player is idle in guild " +
                    guildId
                );

                /*
                 * IMPORTANT:
                 *
                 * Do NOT kill currentProcess here.
                 *
                 * The previous version killed FFmpeg while
                 * the stream was being created, which caused:
                 *
                 * FFmpeg closed with code null
                 */

                music.currentProcess = null;

                if (
                    music.queue.length > 0
                ) {

                    await playNext(
                        guildId
                    );

                } else {

                    music.currentTrack =
                        null;
                }
            }
        );

        /* =================================================
           PLAYER ERROR
        ================================================= */

        player.on(
            "error",
            function (error) {

                console.error(
                    "Audio player error in guild " +
                    guildId +
                    ":",
                    error.message
                );

                music.isPlaying = false;

                music.currentTrack =
                    null;

                music.currentProcess =
                    null;

                if (
                    music.queue.length > 0
                ) {

                    setTimeout(
                        function () {

                            playNext(
                                guildId
                            ).catch(
                                function (nextError) {

                                    console.error(
                                        "Next track error:",
                                        nextError.message
                                    );
                                }
                            );

                        },
                        500
                    );
                }
            }
        );

        guildMusic.set(
            guildId,
            music
        );
    }

    return guildMusic.get(
        guildId
    );
}

/* =========================================================
   COOKIE FUNCTIONS
========================================================= */

function getYouTubeCookieKeys() {

    return Object.keys(process.env)
        .filter(
            function (key) {

                return /^YOUTUBE_COOKIES_\d+$/.test(
                    key
                );
            }
        )
        .sort(
            function (a, b) {

                const numberA =
                    parseInt(
                        a.split("_").pop(),
                        10
                    );

                const numberB =
                    parseInt(
                        b.split("_").pop(),
                        10
                    );

                return numberA - numberB;
            }
        );
}

function getYouTubeCookies() {

    const cookieKeys =
        getYouTubeCookieKeys();

    if (
        cookieKeys.length > 0
    ) {

        return cookieKeys
            .map(
                function (key) {

                    return (
                        process.env[key] ||
                        ""
                    );
                }
            )
            .join("");
    }

    return (
        process.env.YOUTUBE_COOKIES ||
        ""
    );
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

        if (
            cookieKeys.length > 0
        ) {

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

/* =========================================================
   NODE VERSION
========================================================= */

function getNodeMajorVersion() {

    return parseInt(
        process.versions.node.split(".")[0],
        10
    );
}

/* =========================================================
   YT-DLP COMMON ARGS
========================================================= */

function getYtDlpCommonArgs() {

    const args = [
        "--no-warnings",
        "--no-progress",
        "--extractor-args",
        "youtube:player_client=default,-tv_downgraded,web_embedded"
    ];

    /*
     * Node 22 + EJS
     */

    if (
        getNodeMajorVersion() >= 22
    ) {

        args.push(
            "--js-runtimes",
            "node"
        );

        args.push(
            "--remote-components",
            "ejs:github"
        );
    }

    /*
     * Cookies
     */

    if (
        fs.existsSync(cookiesPath)
    ) {

        args.push(
            "--cookies",
            cookiesPath
        );
    }

    return args;
}

/* =========================================================
   SETUP YT-DLP
========================================================= */

async function setupYtDlp() {

    console.log(
        "Setting up yt-dlp..."
    );

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

        setupYouTubeCookies();

        console.log(
            "Node.js version:",
            process.versions.node
        );

    } catch (error) {

        console.error(
            "yt-dlp setup failed:",
            error.message
        );

        process.exit(1);
    }
}

/* =========================================================
   URL CHECK
========================================================= */

function isUrl(input) {

    try {

        const url =
            new URL(input);

        return (
            url.protocol === "http:" ||
            url.protocol === "https:"
        );

    } catch (error) {

        return false;
    }
}

/* =========================================================
   YOUTUBE URL CHECK
========================================================= */

function isYouTubeUrl(input) {

    try {

        const url =
            new URL(input);

        const hostname =
            url.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        return (
            hostname === "youtube.com" ||
            hostname === "youtu.be" ||
            hostname.endsWith(
                ".youtube.com"
            )
        );

    } catch (error) {

        return false;
    }
}

/* =========================================================
   YOUTUBE PLAYLIST CHECK
========================================================= */

function isYouTubePlaylistUrl(input) {

    try {

        const url =
            new URL(input);

        const hostname =
            url.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        const isYouTube =
            hostname === "youtube.com" ||
            hostname === "youtu.be" ||
            hostname.endsWith(
                ".youtube.com"
            );

        return (
            isYouTube &&
            url.searchParams.has("list")
        );

    } catch (error) {

        return false;
    }
}

/* =========================================================
   SEARCH YOUTUBE
========================================================= */

async function searchYouTube(query) {

    console.log(
        "Searching YouTube for:",
        query
    );

    try {

        const args = [
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--skip-download"
        ];

        if (
            getNodeMajorVersion() >= 22
        ) {

            args.push(
                "--js-runtimes",
                "node"
            );

            args.push(
                "--remote-components",
                "ejs:github"
            );
        }

        if (
            fs.existsSync(cookiesPath)
        ) {

            args.push(
                "--cookies",
                cookiesPath
            );
        }

        args.push(
            "ytsearch1:" +
            query
        );

        const output =
            await ytDlp.execPromise(
                args
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

        const track = {

            id: video.id,

            title:
                video.title ||
                "Unknown title",

            url:
                "https://www.youtube.com/watch?v=" +
                video.id
        };

        console.log(
            "Found:",
            track.title
        );

        return track;

    } catch (error) {

        console.error(
            "YouTube search error:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   GET SINGLE VIDEO INFO
========================================================= */

async function getVideoInfo(url) {

    try {

        const args = [
            "--dump-single-json",
            "--no-warnings",
            "--skip-download",
            "--no-playlist"
        ];

        if (
            getNodeMajorVersion() >= 22
        ) {

            args.push(
                "--js-runtimes",
                "node"
            );

            args.push(
                "--remote-components",
                "ejs:github"
            );
        }

        if (
            fs.existsSync(cookiesPath)
        ) {

            args.push(
                "--cookies",
                cookiesPath
            );
        }

        args.push(url);

        const output =
            await ytDlp.execPromise(
                args
            );

        const info =
            JSON.parse(
                String(output)
            );

        if (!info) {
            return null;
        }

        if (
            info._type === "playlist"
        ) {

            return null;
        }

        if (!info.id) {
            return null;
        }

        return {

            id: info.id,

            title:
                info.title ||
                "Unknown title",

            url:
                info.webpage_url ||
                url
        };

    } catch (error) {

        console.error(
            "Video info error:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   GET YOUTUBE PLAYLIST
========================================================= */

async function getYouTubePlaylist(url) {

    console.log(
        "Reading YouTube playlist..."
    );

    try {

        const args = [
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--skip-download"
        ];

        if (
            getNodeMajorVersion() >= 22
        ) {

            args.push(
                "--js-runtimes",
                "node"
            );

            args.push(
                "--remote-components",
                "ejs:github"
            );
        }

        if (
            fs.existsSync(cookiesPath)
        ) {

            args.push(
                "--cookies",
                cookiesPath
            );
        }

        /*
         * IMPORTANT:
         *
         * Do NOT add --no-playlist here.
         */

        args.push(url);

        const output =
            await ytDlp.execPromise(
                args
            );

        const data =
            JSON.parse(
                String(output)
            );

        if (
            !data ||
            !data.entries
        ) {

            return [];
        }

        const tracks = [];

        for (
            const item of data.entries
        ) {

            if (
                !item ||
                !item.id
            ) {
                continue;
            }

            tracks.push({

                id: item.id,

                title:
                    item.title ||
                    "Unknown title",

                url:
                    "https://www.youtube.com/watch?v=" +
                    item.id
            });
        }

        console.log(
            "Playlist tracks found:",
            tracks.length
        );

        return tracks;

    } catch (error) {

        console.error(
            "Playlist error:",
            error.message
        );

        return [];
    }
}

/* =========================================================
   AUDIO STREAM
   YT-DLP -> FFMPEG -> RAW PCM
========================================================= */

function getAudioStream(
    url,
    guildId,
    thisPlayback
) {

    return new Promise(
        function (resolve, reject) {

            const music =
                getGuildMusic(
                    guildId
                );

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

            let ytProcess =
                null;

            let ffmpegProcess =
                null;

            let resolved =
                false;

            let ytError =
                "";

            let ffmpegError =
                "";

            try {

                /* =========================================
                   YT-DLP ARGS
                ========================================= */

                const ytArgs = [
                    "-f",
                    "bestaudio/best",

                    "--no-playlist",

                    "--no-warnings",

                    "--no-progress",

                    "-o",
                    "-",

                    url
                ];

                if (
                    getNodeMajorVersion() >= 22
                ) {

                    ytArgs.splice(
                        ytArgs.length - 1,
                        0,

                        "--js-runtimes",
                        "node",

                        "--remote-components",
                        "ejs:github"
                    );
                }

                if (
                    fs.existsSync(cookiesPath)
                ) {

                    ytArgs.splice(
                        ytArgs.length - 1,
                        0,

                        "--cookies",
                        cookiesPath
                    );
                }

                /* =========================================
                   YT-DLP PROCESS
                ========================================= */

                ytProcess =
                    spawn(
                        ytDlpPath,
                        ytArgs,
                        {
                            stdio: [
                                "ignore",
                                "pipe",
                                "pipe"
                            ]
                        }
                    );

                /* =========================================
                   FFMPEG PROCESS
                ========================================= */

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

                /* =========================================
                   SAVE CURRENT PROCESS
                ========================================= */

                const controller = {

                    yt: ytProcess,

                    ffmpeg:
                        ffmpegProcess,

                    kill: function () {

                        console.log(
                            "Killing audio processes in guild " +
                            guildId
                        );

                        try {

                            if (
                                ytProcess &&
                                !ytProcess.killed
                            ) {

                                ytProcess.kill(
                                    "SIGKILL"
                                );
                            }

                        } catch (error) {}

                        try {

                            if (
                                ffmpegProcess &&
                                !ffmpegProcess.killed
                            ) {

                                ffmpegProcess.kill(
                                    "SIGKILL"
                                );
                            }

                        } catch (error) {}
                    }
                };

                music.currentProcess =
                    controller;

                /* =========================================
                   YT-DLP STDERR
                ========================================= */

                ytProcess.stderr.on(
                    "data",
                    function (data) {

                        const text =
                            data.toString();

                        ytError += text;

                        if (
                            text
                                .toUpperCase()
                                .includes("ERROR")
                        ) {

                            console.error(
                                text.trim()
                            );
                        }
                    }
                );

                /* =========================================
                   FFMPEG STDERR
                ========================================= */

                ffmpegProcess.stderr.on(
                    "data",
                    function (data) {

                        const text =
                            data.toString();

                        ffmpegError += text;

                        if (
                            text.trim()
                        ) {

                            console.error(
                                "FFmpeg:",
                                text.trim()
                            );
                        }
                    }
                );

                /* =========================================
                   SAFE PIPE ERRORS
                ========================================= */

                ytProcess.stdout.on(
                    "error",
                    function (error) {

                        if (
                            error.code ===
                            "EPIPE"
                        ) {

                            return;
                        }

                        console.error(
                            "yt-dlp stdout error:",
                            error.message
                        );
                    }
                );

                ffmpegProcess.stdin.on(
                    "error",
                    function (error) {

                        if (
                            error.code ===
                            "EPIPE"
                        ) {

                            return;
                        }

                        console.error(
                            "FFmpeg stdin error:",
                            error.message
                        );
                    }
                );

                ffmpegProcess.stdout.on(
                    "error",
                    function (error) {

                        if (
                            error.code ===
                            "EPIPE"
                        ) {

                            return;
                        }

                        console.error(
                            "FFmpeg stdout error:",
                            error.message
                        );
                    }
                );

                /* =========================================
                   PIPE YT-DLP -> FFMPEG
                ========================================= */

                ytProcess.stdout.pipe(
                    ffmpegProcess.stdin
                );

                /* =========================================
                   FIRST AUDIO DATA
                ========================================= */

                ffmpegProcess.stdout.once(
                    "data",
                    function (data) {

                        if (
                            resolved
                        ) {
                            return;
                        }

                        if (
                            thisPlayback !==
                            music.playbackId
                        ) {

                            return;
                        }

                        if (
                            !data ||
                            data.length === 0
                        ) {

                            return;
                        }

                        resolved =
                            true;

                        console.log(
                            "yt-dlp started sending audio data in guild " +
                            guildId
                        );

                        resolve({

                            stream:
                                ffmpegProcess.stdout,

                            process:
                                controller
                        });
                    }
                );

                /* =========================================
                   YT-DLP ERROR
                ========================================= */

                ytProcess.on(
                    "error",
                    function (error) {

                        console.error(
                            "yt-dlp process error:",
                            error.message
                        );

                        if (
                            !resolved
                        ) {

                            resolved =
                                true;

                            reject(error);
                        }
                    }
                );

                /* =========================================
                   FFMPEG ERROR
                ========================================= */

                ffmpegProcess.on(
                    "error",
                    function (error) {

                        console.error(
                            "FFmpeg process error:",
                            error.message
                        );

                        if (
                            !resolved
                        ) {

                            resolved =
                                true;

                            reject(error);
                        }
                    }
                );

                /* =========================================
                   YT-DLP CLOSE
                ========================================= */

                ytProcess.on(
                    "close",
                    function (code) {

                        console.log(
                            "yt-dlp process closed with code " +
                            code +
                            " in guild " +
                            guildId
                        );

                        /*
                         * If the process was deliberately killed
                         * by !stop or !skip, don't report it as
                         * a playback error.
                         */

                        if (
                            code !== 0 &&
                            !resolved &&
                            thisPlayback ===
                                music.playbackId
                        ) {

                            resolved =
                                true;

                            reject(
                                new Error(
                                    "yt-dlp exited with code " +
                                    code +
                                    ". " +
                                    ytError.trim()
                                )
                            );
                        }
                    }
                );

                /* =========================================
                   FFMPEG CLOSE
                ========================================= */

                ffmpegProcess.on(
                    "close",
                    function (code) {

                        console.log(
                            "FFmpeg closed with code " +
                            code +
                            " in guild " +
                            guildId
                        );

                        /*
                         * code === null normally means
                         * the process was killed.
                         *
                         * Don't treat that as a natural
                         * FFmpeg extraction failure if the
                         * playback was replaced/stopped.
                         */

                        if (
                            code !== 0 &&
                            code !== null &&
                            !resolved &&
                            thisPlayback ===
                                music.playbackId
                        ) {

                            resolved =
                                true;

                            reject(
                                new Error(
                                    "FFmpeg exited with code " +
                                    code +
                                    ". " +
                                    ffmpegError.trim()
                                )
                            );
                        }
                    }
                );

            } catch (error) {

                console.error(
                    "Audio stream setup error:",
                    error.message
                );

                try {

                    if (
                        ytProcess
                    ) {

                        ytProcess.kill(
                            "SIGKILL"
                        );
                    }

                } catch (err) {}

                try {

                    if (
                        ffmpegProcess
                    ) {

                        ffmpegProcess.kill(
                            "SIGKILL"
                        );
                    }

                } catch (err) {}

                reject(error);
            }
        }
    );
}

/* =========================================================
   CONNECT TO VOICE
========================================================= */

async function connectToVoice(
    message,
    music
) {

    const voiceChannel =
        message.member &&
        message.member.voice &&
        message.member.voice.channel;

    if (!voiceChannel) {

        throw new Error(
            "You need to join a voice channel first."
        );
    }

    if (
        music.connection &&
        music.connection.state.status ===
            VoiceConnectionStatus.Ready
    ) {

        return;
    }

    if (
        music.connection
    ) {

        try {

            music.connection.destroy();

        } catch (error) {}

        music.connection =
            null;
    }

    const connection =
        joinVoiceChannel({

            channelId:
                voiceChannel.id,

            guildId:
                message.guild.id,

            adapterCreator:
                message.guild
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

    console.log(
        "Connected to voice channel " +
        voiceChannel.name +
        " in guild " +
        message.guild.id
    );
}

/* =========================================================
   PLAY NEXT
========================================================= */

async function playNext(
    guildId
) {

    const music =
        getGuildMusic(
            guildId
        );

    if (
        music.queue.length === 0
    ) {

        music.currentTrack =
            null;

        music.isPlaying =
            false;

        music.currentProcess =
            null;

        return;
    }

    const track =
        music.queue.shift();

    music.currentTrack =
        track;

    music.playbackId++;

    const thisPlayback =
        music.playbackId;

    console.log(
        "Playing playback #" +
        thisPlayback +
        " in guild " +
        guildId +
        ": " +
        track.title
    );

    try {

        const audio =
            await getAudioStream(
                track.url,
                guildId,
                thisPlayback
            );

        /*
         * A newer playback replaced this one.
         */

        if (
            thisPlayback !==
            music.playbackId
        ) {

            try {

                if (
                    audio.process
                ) {

                    audio.process.kill();
                }

            } catch (error) {}

            return;
        }

        const resource =
            createAudioResource(
                audio.stream,
                {
                    inputType:
                        StreamType.Raw
                }
            );

        music.currentProcess =
            audio.process;

        music.player.play(
            resource
        );

        console.log(
            "Audio player started in guild " +
            guildId +
            ": " +
            track.title
        );

    } catch (error) {

        console.error(
            "Playback error in guild " +
            guildId +
            ":",
            error.message
        );

        music.currentProcess =
            null;

        music.currentTrack =
            null;

        music.isPlaying =
            false;

        /*
         * Try next track.
         */

        if (
            music.queue.length > 0
        ) {

            setTimeout(
                function () {

                    playNext(
                        guildId
                    ).catch(
                        function (nextError) {

                            console.error(
                                "Next track error:",
                                nextError.message
                            );
                        }
                    );

                },
                500
            );
        }
    }
}

/* =========================================================
   STOP GUILD AUDIO
========================================================= */

function stopGuildAudio(
    guildId
) {

    const music =
        getGuildMusic(
            guildId
        );

    console.log(
        "Stopping audio in guild " +
        guildId
    );

    /*
     * Increment playback ID first so that any
     * currently starting playback becomes invalid.
     */

    music.playbackId++;

    if (
        music.currentProcess
    ) {

        try {

            music.currentProcess.kill();

        } catch (error) {}

        music.currentProcess =
            null;
    }

    try {

        music.player.stop(
            true
        );

    } catch (error) {}

    music.currentTrack =
        null;

    music.isPlaying =
        false;
}

/* =========================================================
   DISCORD READY
========================================================= */

client.once(
    "clientReady",
    function () {

        console.log(
            "Logged in as " +
            client.user.tag +
            "!"
        );

        console.log(
            "YURI BOT is ready."
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

/* =========================================================
   MESSAGE HANDLER
========================================================= */

client.on(
    "messageCreate",
    async function (message) {

        /* =============================================
           IGNORE BOTS
        ============================================= */

        if (
            message.author.bot
        ) {
            return;
        }

        /* =============================================
           PREFIX
        ============================================= */

        if (
            !message.content.startsWith(
                PREFIX
            )
        ) {
            return;
        }

        /* =============================================
           SERVER ONLY
        ============================================= */

        if (
            !message.guild
        ) {
            return;
        }

        /* =============================================
           PARSE COMMAND
        ============================================= */

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

        /* =============================================
           SERVER MUSIC STATE
        ============================================= */

        const guildId =
            message.guild.id;

        const music =
            getGuildMusic(
                guildId
            );

        /* =================================================
           HELLO
        ================================================= */

        if (
            lowerCommand === "hello"
        ) {

            await message.reply(
                "ano na naman kailangan mo?"
            );

            return;
        }

        /* =================================================
           PING
        ================================================= */

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

        /* =================================================
           JOIN
        ================================================= */

        if (
            lowerCommand === "join"
        ) {

            try {

                await connectToVoice(
                    message,
                    music
                );

                await message.reply(
                    "Joined your voice channel."
                );

            } catch (error) {

                console.error(
                    "Join error:",
                    error.message
                );

                await message.reply(
                    "I couldn't join your voice channel."
                );
            }

            return;
        }

        /* =================================================
           PLAY
        ================================================= */

        if (
            lowerCommand === "play"
        ) {

            const query =
                args.join(" ");

            if (!query) {

                await message.reply(
                    [
                        "**Usage:**",
                        "`!play <song>`",
                        "`!play <YouTube video link>`",
                        "`!play <YouTube playlist link>`"
                    ].join("\n")
                );

                return;
            }

            const voiceChannel =
                message.member &&
                message.member.voice &&
                message.member.voice.channel;

            if (!voiceChannel) {

                await message.reply(
                    "Join a voice channel first."
                );

                return;
            }

            let statusMessage =
                null;

            try {

                /* =====================================
                   CONNECT
                ===================================== */

                await connectToVoice(
                    message,
                    music
                );

                /* =====================================
                   YOUTUBE PLAYLIST
                ===================================== */

                if (
                    isYouTubePlaylistUrl(
                        query
                    )
                ) {

                    statusMessage =
                        await message.reply(
                            "📋 Reading YouTube playlist..."
                        );

                    const tracks =
                        await getYouTubePlaylist(
                            query
                        );

                    if (
                        tracks.length === 0
                    ) {

                        await statusMessage.edit(
                            "❌ I couldn't find any songs in that playlist."
                        );

                        return;
                    }

                    for (
                        const track of tracks
                    ) {

                        music.queue.push(
                            track
                        );
                    }

                    await statusMessage.edit(
                        "✅ Added **" +
                        tracks.length +
                        "** songs to the queue."
                    );

                    if (
                        !music.isPlaying &&
                        !music.currentTrack
                    ) {

                        await playNext(
                            guildId
                        );
                    }

                    return;
                }

                /* =====================================
                   YOUTUBE VIDEO LINK
                ===================================== */

                if (
                    isYouTubeUrl(
                        query
                    )
                ) {

                    statusMessage =
                        await message.reply(
                            "🔎 Getting the YouTube video..."
                        );

                    const track =
                        await getVideoInfo(
                            query
                        );

                    if (!track) {

                        await statusMessage.edit(
                            "❌ I couldn't read that YouTube link."
                        );

                        return;
                    }

                    const alreadyPlaying =
                        music.isPlaying ||
                        music.currentTrack;

                    music.queue.push(
                        track
                    );

                    await statusMessage.edit(
                        alreadyPlaying
                            ? "➕ Added to queue: **" +
                              track.title +
                              "**"
                            : "🎵 Now playing: **" +
                              track.title +
                              "**"
                    );

                    if (
                        !music.isPlaying &&
                        !music.currentTrack
                    ) {

                        await playNext(
                            guildId
                        );
                    }

                    return;
                }

                /* =====================================
                   OTHER URL
                ===================================== */

                if (
                    isUrl(query)
                ) {

                    await message.reply(
                        "❌ That link isn't a supported YouTube link.\n\n" +
                        "Use a YouTube video or YouTube playlist link."
                    );

                    return;
                }

                /* =====================================
                   NORMAL SONG SEARCH
                ===================================== */

                statusMessage =
                    await message.reply(
                        "🔎 Searching YouTube for **" +
                        query +
                        "**..."
                    );

                const track =
                    await searchYouTube(
                        query
                    );

                if (!track) {

                    await statusMessage.edit(
                        "❌ I couldn't find that song."
                    );

                    return;
                }

                const alreadyPlaying =
                    music.isPlaying ||
                    music.currentTrack;

                music.queue.push(
                    track
                );

                await statusMessage.edit(
                    alreadyPlaying
                        ? "➕ Added to queue: **" +
                          track.title +
                          "**"
                        : "🎵 Now playing: **" +
                          track.title +
                          "**"
                );

                if (
                    !music.isPlaying &&
                    !music.currentTrack
                ) {

                    await playNext(
                        guildId
                    );
                }

            } catch (error) {

                console.error(
                    "Play command error:",
                    error.message
                );

                try {

                    if (
                        statusMessage
                    ) {

                        await statusMessage.edit(
                            "❌ Something went wrong:\n" +
                            error.message
                        );

                    } else {

                        await message.reply(
                            "❌ Something went wrong:\n" +
                            error.message
                        );
                    }

                } catch (sendError) {

                    console.error(
                        "Failed to send error message:",
                        sendError.message
                    );
                }
            }

            return;
        }

        /* =================================================
           QUEUE
        ================================================= */

        if (
            lowerCommand === "queue"
        ) {

            if (
                !music.currentTrack &&
                music.queue.length === 0
            ) {

                await message.reply(
                    "📭 The queue is empty."
                );

                return;
            }

            const lines = [];

            if (
                music.currentTrack
            ) {

                lines.push(
                    "🎵 **Now playing:**",
                    music.currentTrack.title
                );
            }

            if (
                music.queue.length > 0
            ) {

                lines.push(
                    "",
                    "📋 **Up next:**"
                );

                const displayQueue =
                    music.queue.slice(
                        0,
                        15
                    );

                displayQueue.forEach(
                    function (
                        track,
                        index
                    ) {

                        lines.push(
                            (index + 1) +
                            ". " +
                            track.title
                        );
                    }
                );

                if (
                    music.queue.length > 15
                ) {

                    lines.push(
                        "",
                        "...and " +
                        (
                            music.queue.length -
                            15
                        ) +
                        " more."
                    );
                }
            }

            await message.reply(
                lines.join("\n")
            );

            return;
        }

        /* =================================================
           SKIP
        ================================================= */

        if (
            lowerCommand === "skip"
        ) {

            if (
                !music.currentTrack
            ) {

                await message.reply(
                    "Nothing is currently playing."
                );

                return;
            }

            /*
             * Invalidate current playback.
             */

            music.playbackId++;

            /*
             * Kill yt-dlp + FFmpeg.
             */

            if (
                music.currentProcess
            ) {

                try {

                    music.currentProcess.kill();

                } catch (error) {}

                music.currentProcess =
                    null;
            }

            try {

                music.player.stop(
                    true
                );

            } catch (error) {}

            music.currentTrack =
                null;

            music.isPlaying =
                false;

            if (
                music.queue.length > 0
            ) {

                await message.reply(
                    "⏭️ Skipped. Playing the next song..."
                );

                await playNext(
                    guildId
                );

            } else {

                await message.reply(
                    "⏭️ Skipped. The queue is empty."
                );
            }

            return;
        }

        /* =================================================
           STOP
        ================================================= */

        if (
            lowerCommand === "stop"
        ) {

            music.queue =
                [];

            stopGuildAudio(
                guildId
            );

            await message.reply(
                "⏹️ Stopped the music and cleared the queue."
            );

            return;
        }

        /* =================================================
           LEAVE
        ================================================= */

        if (
            lowerCommand === "leave"
        ) {

            music.queue =
                [];

            stopGuildAudio(
                guildId
            );

            if (
                music.connection
            ) {

                try {

                    music.connection.destroy();

                } catch (error) {}

                music.connection =
                    null;
            }

            await message.reply(
                "👋 Left the voice channel."
            );

            return;
        }

        /* =================================================
           HELP
        ================================================= */

        if (
            lowerCommand === "help"
        ) {

            await message.reply(
                [
                    "**🎵 YURI BOT COMMANDS**",
                    "",
                    "`!play <song>` — Search YouTube",
                    "`!play <YouTube link>` — Play a video",
                    "`!play <YouTube playlist>` — Add playlist",
                    "`!queue` — Show queue",
                    "`!skip` — Skip current song",
                    "`!stop` — Stop and clear queue",
                    "`!join` — Join voice channel",
                    "`!leave` — Leave voice channel",
                    "`!ping` — Check latency",
                    "`!hello` — Say hello",
                    "`!help` — Show commands"
                ].join("\n")
            );

            return;
        }
    }
);

/* =========================================================
   START BOT
========================================================= */

async function startBot() {

    try {

        /*
         * Create cookie file once.
         */

        setupYouTubeCookies();

        /*
         * Setup yt-dlp.
         */

        await setupYtDlp();

        /*
         * Login.
         */

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
