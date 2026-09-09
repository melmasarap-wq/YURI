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

/* =========================================================
   CONFIG
========================================================= */

const PREFIX = "!";
const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";

const cookiesPath = path.join(
    "/tmp",
    "youtube-cookies.txt"
);

/* =========================================================
   CHECK TOKEN
========================================================= */

if (!process.env.TOKEN) {
    console.error("TOKEN is missing!");
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
   YT-DLP
========================================================= */

let ytDlp = null;

/* =========================================================
   PER-GUILD MUSIC STATE
========================================================= */

const guildMusic = new Map();

function getGuildMusic(guildId) {
    if (!guildMusic.has(guildId)) {
        const player = createAudioPlayer();

        const music = {
            player: player,
            connection: null,
            currentProcess: null,
            playbackId: 0,
            queue: [],
            currentTrack: null,
            isPlaying: false
        };

        /* =============================================
           PLAYER EVENTS
        ============================================= */

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

        player.on(
            AudioPlayerStatus.Idle,
            async function () {
                music.isPlaying = false;

                console.log(
                    "Audio player is idle in guild " +
                    guildId
                );

                /*
                 * Do not immediately destroy the connection.
                 * Play the next queued song instead.
                 */

                if (music.currentProcess) {
                    try {
                        music.currentProcess.kill();
                    } catch (error) {}
                }

                music.currentProcess = null;

                if (music.queue.length > 0) {
                    await playNext(guildId);
                } else {
                    music.currentTrack = null;
                }
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

                music.isPlaying = false;

                if (music.queue.length > 0) {
                    setTimeout(function () {
                        playNext(guildId).catch(
                            function (nextError) {
                                console.error(
                                    "Next song error:",
                                    nextError
                                );
                            }
                        );
                    }, 500);
                }
            }
        );

        guildMusic.set(guildId, music);
    }

    return guildMusic.get(guildId);
}

/* =========================================================
   YOUTUBE COOKIE VARIABLES
========================================================= */

function getYouTubeCookieKeys() {
    return Object.keys(process.env)
        .filter(function (key) {
            return /^YOUTUBE_COOKIES_\d+$/.test(key);
        })
        .sort(function (a, b) {
            const numberA = parseInt(
                a.split("_").pop(),
                10
            );

            const numberB = parseInt(
                b.split("_").pop(),
                10
            );

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
    const cookies = getYouTubeCookies();
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

/* =========================================================
   YT-DLP COMMON ARGUMENTS
========================================================= */

function getYtDlpCommonArgs() {
    const args = [
        "--no-warnings",
        "--no-progress",
        "--no-playlist",
        "--extractor-args",
        "youtube:player_client=default,-tv_downgraded,web_embedded"
    ];

    /*
     * Node 22 is required for yt-dlp's Node JS runtime.
     */

    const nodeMajor =
        parseInt(
            process.versions.node.split(".")[0],
            10
        );

    if (nodeMajor >= 22) {
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
    }

    const cookieFile =
        setupYouTubeCookies();

    if (cookieFile) {
        args.push(
            "--cookies",
            cookieFile
        );
    }

    return args;
}

/* =========================================================
   SETUP YT-DLP
========================================================= */

async function setupYtDlp() {
    console.log("Setting up yt-dlp...");

    ytDlp = new YTDlpWrap(
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

        /*
         * Prepare cookie file once at startup.
         */

        setupYouTubeCookies();

    } catch (error) {
        console.error(
            "yt-dlp is not working."
        );

        console.error(error);

        process.exit(1);
    }
}

/* =========================================================
   URL DETECTION
========================================================= */

function isUrl(input) {
    try {
        const parsed =
            new URL(input);

        return (
            parsed.protocol === "http:" ||
            parsed.protocol === "https:"
        );
    } catch (error) {
        return false;
    }
}

function isYouTubePlaylistUrl(input) {
    try {
        const parsed =
            new URL(input);

        const hostname =
            parsed.hostname
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
            parsed.searchParams.has("list")
        );
    } catch (error) {
        return false;
    }
}

function isYouTubeUrl(input) {
    try {
        const parsed =
            new URL(input);

        const hostname =
            parsed.hostname
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

        const cookieFile =
            setupYouTubeCookies();

        if (cookieFile) {
            args.push(
                "--cookies",
                cookieFile
            );
        }

        const nodeMajor =
            parseInt(
                process.versions.node.split(".")[0],
                10
            );

        if (nodeMajor >= 22) {
            args.push(
                "--js-runtimes",
                "node"
            );

            args.push(
                "--remote-components",
                "ejs:github"
            );
        }

        args.push(
            "ytsearch1:" + query
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

/* =========================================================
   GET SINGLE URL INFORMATION
========================================================= */

async function getVideoInfo(url) {
    try {
        console.log(
            "Getting URL information..."
        );

        const args = [
            "--dump-single-json",
            "--no-warnings",
            "--skip-download",
            "--no-playlist"
        ];

        const cookieFile =
            setupYouTubeCookies();

        if (cookieFile) {
            args.push(
                "--cookies",
                cookieFile
            );
        }

        const nodeMajor =
            parseInt(
                process.versions.node.split(".")[0],
                10
            );

        if (nodeMajor >= 22) {
            args.push(
                "--js-runtimes",
                "node"
            );

            args.push(
                "--remote-components",
                "ejs:github"
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
            "URL information error:",
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

        const cookieFile =
            setupYouTubeCookies();

        if (cookieFile) {
            args.push(
                "--cookies",
                cookieFile
            );
        }

        const nodeMajor =
            parseInt(
                process.versions.node.split(".")[0],
                10
            );

        if (nodeMajor >= 22) {
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
         * We intentionally do NOT use --no-playlist here.
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
            if (!item) {
                continue;
            }

            if (!item.id) {
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
   START AUDIO STREAM
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

            let ytProcess = null;
            let ffmpegProcess = null;
            let settled = false;

            try {

                /* =========================================
                   YT-DLP
                ========================================= */

                const ytArgs = [
                    "-f",
                    "bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio",

                    "--no-playlist",
                    "--no-warnings",
                    "--no-progress",

                    "-o",
                    "-",

                    url
                ];

                const cookieFile =
                    setupYouTubeCookies();

                if (cookieFile) {
                    ytArgs.splice(
                        ytArgs.length - 1,
                        0,
                        "--cookies",
                        cookieFile
                    );
                }

                const nodeMajor =
                    parseInt(
                        process.versions.node.split(".")[0],
                        10
                    );

                if (nodeMajor >= 22) {

                    ytArgs.splice(
                        ytArgs.length - 1,
                        0,
                        "--js-runtimes",
                        "node"
                    );

                    ytArgs.splice(
                        ytArgs.length - 1,
                        0,
                        "--remote-components",
                        "ejs:github"
                    );
                }

                ytProcess = spawn(
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

                if (!ytProcess.stdout) {
                    throw new Error(
                        "yt-dlp did not create stdout."
                    );
                }

                /* =========================================
                   FFMPEG
                ========================================= */

                ffmpegProcess = spawn(
                    require("ffmpeg-static"),
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

                if (!ffmpegProcess.stdout) {
                    throw new Error(
                        "FFmpeg did not create stdout."
                    );
                }

                music.currentProcess = {
                    yt: ytProcess,
                    ffmpeg: ffmpegProcess,

                    kill: function () {

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

                /* =========================================
                   YT-DLP STDERR
                ========================================= */

                let ytError = "";

                ytProcess.stderr.on(
                    "data",
                    function (data) {

                        const text =
                            data.toString();

                        ytError += text;

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

                /* =========================================
                   FFMPEG STDERR
                ========================================= */

                let ffmpegError = "";

                ffmpegProcess.stderr.on(
                    "data",
                    function (data) {

                        const text =
                            data.toString();

                        ffmpegError += text;

                        if (text.trim()) {
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

                        /*
                         * Broken pipe / stream errors can
                         * happen when playback is replaced.
                         */

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
                   CONNECT YT-DLP TO FFMPEG
                ========================================= */

                ytProcess.stdout.pipe(
                    ffmpegProcess.stdin
                );

                /* =========================================
                   WAIT FOR FIRST AUDIO DATA
                ========================================= */

                const onAudioData =
                    function (data) {

                        if (settled) {
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

                        settled = true;

                        console.log(
                            "yt-dlp started sending audio data in guild " +
                            guildId
                        );

                        resolve({
                            stream:
                                ffmpegProcess.stdout,

                            process:
                                music.currentProcess
                        });
                    };

                ffmpegProcess.stdout.once(
                    "data",
                    onAudioData
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
                            !settled
                        ) {
                            settled = true;

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
                            !settled
                        ) {
                            settled = true;

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

                        if (
                            code !== 0 &&
                            !settled
                        ) {

                            settled = true;

                            if (
                                ytError.includes(
                                    "Sign in to confirm"
                                ) ||
                                ytError.includes(
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

                        if (
                            !settled &&
                            code !== 0
                        ) {

                            settled = true;

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
                    if (ytProcess) {
                        ytProcess.kill(
                            "SIGKILL"
                        );
                    }
                } catch (err) {}

                try {
                    if (ffmpegProcess) {
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
   STOP CURRENT AUDIO FOR ONE GUILD
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

    music.playbackId++;

    if (music.currentProcess) {

        try {
            music.currentProcess.kill();
        } catch (error) {}

        music.currentProcess = null;
    }

    try {
        music.player.stop(true);
    } catch (error) {}

    music.currentTrack = null;
    music.isPlaying = false;
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

    if (music.connection) {
        try {
            music.connection.destroy();
        } catch (error) {}

        music.connection = null;
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

            selfDeaf: true
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

    return connection;
}

/* =========================================================
   PLAY NEXT TRACK
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
        music.currentTrack = null;
        music.isPlaying = false;
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

        if (
            thisPlayback !==
            music.playbackId
        ) {
            try {
                audio.process.kill();
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

        music.player.play(
            resource
        );

        console.log(
            "Now playing in guild " +
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

        /*
         * Try the next track automatically.
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
                                nextError
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
   ADD TRACK
========================================================= */

async function addTrack(
    message,
    music,
    track
) {
    music.queue.push(
        track
    );

    if (
        !music.isPlaying &&
        !music.currentTrack
    ) {
        await playNext(
            message.guild.id
        );

        return {
            started: true
        };
    }

    return {
        started: false
    };
}

/* =========================================================
   READY
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
           ARGUMENTS
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
           ONLY SERVER COMMANDS
        ============================================= */

        if (!message.guild) {
            return;
        }

        /* =============================================
           THIS SERVER'S MUSIC STATE
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
                "Hello! I'm YURI BOT!"
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

                const voiceChannel =
                    message.member.voice.channel;

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
                    "Usage:\n" +
                    "!play <song name>\n" +
                    "!play <YouTube link>\n" +
                    "!play <YouTube playlist link>"
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

            let statusMessage = null;

            try {

                /* =====================================
                   CONNECT FIRST
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
                            "Reading YouTube playlist..."
                        );

                    const tracks =
                        await getYouTubePlaylist(
                            query
                        );

                    if (
                        tracks.length === 0
                    ) {

                        await statusMessage.edit(
                            "I couldn't find any songs in that YouTube playlist."
                        );

                        return;
                    }

                    /*
                     * Add entire playlist
                     */

                    for (
                        const track of tracks
                    ) {
                        music.queue.push(
                            track
                        );
                    }

                    await statusMessage.edit(
                        "Added **" +
                        tracks.length +
                        "** songs to the queue."
                    );

                    /*
                     * Start playback if idle
                     */

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
                   SINGLE YOUTUBE / SUPPORTED URL
                ===================================== */

                if (
                    isUrl(query)
                ) {

                    statusMessage =
                        await message.reply(
                            "Getting the song..."
                        );

                    const track =
                        await getVideoInfo(
                            query
                        );

                    if (!track) {

                        await statusMessage.edit(
                            "I couldn't read that link.\n\n" +
                            "For now, use a YouTube video link or YouTube playlist link."
                        );

                        return;
                    }

                    const wasPlaying =
                        music.isPlaying ||
                        music.currentTrack;

                    music.queue.push(
                        track
                    );

                    await statusMessage.edit(
                        wasPlaying
                            ? "Added to queue: **" +
                              track.title +
                              "**"
                            : "Now playing: **" +
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
                   NORMAL SEARCH
                ===================================== */

                statusMessage =
                    await message.reply(
                        "Searching YouTube for **" +
                        query +
                        "**..."
                    );

                const track =
                    await searchYouTube(
                        query
                    );

                if (!track) {

                    await statusMessage.edit(
                        "I couldn't find that song."
                    );

                    return;
                }

                const wasPlaying =
                    music.isPlaying ||
                    music.currentTrack;

                music.queue.push(
                    track
                );

                await statusMessage.edit(
                    wasPlaying
                        ? "Added to queue: **" +
                          track.title +
                          "**"
                        : "Now playing: **" +
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
                    error
                );

                try {

                    if (
                        statusMessage
                    ) {

                        await statusMessage.edit(
                            "Something went wrong:\n" +
                            error.message
                        );

                    } else {

                        await message.reply(
                            "Something went wrong:\n" +
                            error.message
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
                music.player.stop(true);
            } catch (error) {}

            music.currentTrack =
                null;

            music.isPlaying =
                false;

            if (
                music.queue.length > 0
            ) {

                await message.reply(
                    "Skipped. Playing the next song..."
                );

                await playNext(
                    guildId
                );

            } else {

                await message.reply(
                    "Skipped. The queue is empty."
                );
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
                    "The queue is empty."
                );

                return;
            }

            const lines = [];

            if (
                music.currentTrack
            ) {

                lines.push(
                    "🎵 **Now playing:** " +
                    music.currentTrack.title
                );
            }

            if (
                music.queue.length > 0
            ) {

                lines.push(
                    "",
                    "**Up next:**"
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
                "Stopped the music and cleared the queue."
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
                "Left the voice channel."
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
                    "**YURI BOT COMMANDS**",
                    "",
                    "`!play <song>` - Search and play a song",
                    "`!play <YouTube link>` - Play a YouTube video",
                    "`!play <YouTube playlist>` - Queue a playlist",
                    "`!queue` - Show the music queue",
                    "`!skip` - Skip the current song",
                    "`!stop` - Stop and clear queue",
                    "`!join` - Join your voice channel",
                    "`!leave` - Leave voice channel",
                    "`!ping` - Check bot latency",
                    "`!hello` - Say hello",
                    "`!help` - Show commands"
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
