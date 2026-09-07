require("dotenv").config();

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require("@discordjs/voice");

const YTDlpWrap = require("yt-dlp-wrap").default || require("yt-dlp-wrap");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PREFIX = "!";

const ytDlpPath = path.join(__dirname, "yt-dlp");

let ytDlp = null;
let connection = null;
let currentYtDlpProcess = null;
let currentFfmpegProcess = null;

// ===============================
// DISCORD CLIENT
// ===============================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ===============================
// AUDIO PLAYER
// ===============================

const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
    }
});

player.on(AudioPlayerStatus.Playing, () => {
    console.log("▶️ Audio is playing.");
});

player.on(AudioPlayerStatus.Idle, () => {
    console.log("⏹️ Audio finished.");

    cleanupProcesses();
});

player.on("error", (error) => {
    console.error("❌ Audio player error:", error);

    cleanupProcesses();
});

// ===============================
// CLEANUP
// ===============================

function cleanupProcesses() {
    if (currentYtDlpProcess) {
        try {
            currentYtDlpProcess.kill("SIGKILL");
        } catch (error) {
            console.log("yt-dlp already stopped.");
        }

        currentYtDlpProcess = null;
    }

    if (currentFfmpegProcess) {
        try {
            currentFfmpegProcess.kill("SIGKILL");
        } catch (error) {
            console.log("FFmpeg already stopped.");
        }

        currentFfmpegProcess = null;
    }
}

// ===============================
// SETUP YT-DLP
// ===============================

async function setupYtDlp() {
    try {
        console.log("Checking yt-dlp...");

        if (!fs.existsSync(ytDlpPath)) {
            console.log("Downloading yt-dlp...");

            await YTDlpWrap.downloadFromGithub(
                "latest",
                ytDlpPath
            );

            console.log("✅ yt-dlp downloaded.");
        }

        ytDlp = new YTDlpWrap(ytDlpPath);

        console.log("✅ yt-dlp is ready.");

    } catch (error) {
        console.error("❌ Failed to setup yt-dlp:", error);
        throw error;
    }
}

// ===============================
// SOUNDCLOUD SEARCH
// ===============================

async function searchSoundCloud(query) {
    if (!ytDlp) {
        throw new Error("yt-dlp is not ready.");
    }

    console.log(`🔎 Searching SoundCloud: ${query}`);

    try {
        const output = await ytDlp.execPromise([
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--no-playlist",
            "--skip-download",
            `scsearch1:${query}`
        ]);

        if (!output) {
            throw new Error("No search result returned.");
        }

        const data = JSON.parse(output);

        let result = data;

        if (data.entries && data.entries.length > 0) {
            result = data.entries[0];
        }

        if (!result || !result.url) {
            throw new Error("No SoundCloud result found.");
        }

        console.log(`🎵 Found: ${result.title || "Unknown title"}`);
        console.log(`🔗 URL: ${result.webpage_url || result.url}`);

        return {
            title: result.title || "Unknown title",
            url: result.webpage_url || result.url
        };

    } catch (error) {
        console.error("❌ SoundCloud search error:", error);
        throw error;
    }
}

// ===============================
// GET AUDIO STREAM
// ===============================

async function getAudioStream(url) {
    if (!ytDlp) {
        throw new Error("yt-dlp is not ready.");
    }

    console.log("🎧 Starting yt-dlp audio stream...");

    const ytDlpWrapperProcess = ytDlp.exec([
        url,
        "-f",
        "bestaudio/best",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "-o",
        "-"
    ]);

    if (!ytDlpWrapperProcess) {
        throw new Error("yt-dlp process could not be created.");
    }

    // IMPORTANT:
    // yt-dlp-wrap exec() returns an object.
    // The actual ChildProcess is .ytDlpProcess
    const process = ytDlpWrapperProcess.ytDlpProcess;

    if (!process) {
        throw new Error("yt-dlp child process was not created.");
    }

    currentYtDlpProcess = process;

    process.on("error", (error) => {
        console.error("❌ yt-dlp process error:", error);
    });

    process.on("close", (code) => {
        console.log(`yt-dlp exited with code ${code}`);

        if (currentYtDlpProcess === process) {
            currentYtDlpProcess = null;
        }
    });

    if (process.stderr) {
        process.stderr.on("data", (data) => {
            const message = data.toString().trim();

            if (message) {
                console.log(`yt-dlp: ${message}`);
            }
        });
    }

    if (!process.stdout) {
        throw new Error("yt-dlp did not provide stdout.");
    }

    console.log("✅ yt-dlp stdout received.");

    return process.stdout;
}

// ===============================
// START FFMPEG
// ===============================

function startFFmpeg(inputStream) {
    if (!ffmpegPath) {
        throw new Error("FFmpeg was not found.");
    }

    console.log("🎛️ Starting FFmpeg...");

    const ffmpegProcess = spawn(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",

        "-i",
        "pipe:0",

        "-f",
        "s16le",

        "-ar",
        "48000",

        "-ac",
        "2",

        "pipe:1"
    ]);

    currentFfmpegProcess = ffmpegProcess;

    ffmpegProcess.on("error", (error) => {
        console.error("❌ FFmpeg process error:", error);
    });

    ffmpegProcess.on("close", (code) => {
        console.log(`FFmpeg exited with code ${code}`);

        if (currentFfmpegProcess === ffmpegProcess) {
            currentFfmpegProcess = null;
        }
    });

    if (ffmpegProcess.stderr) {
        ffmpegProcess.stderr.on("data", (data) => {
            const message = data.toString().trim();

            if (message) {
                console.error(`FFmpeg: ${message}`);
            }
        });
    }

    inputStream.pipe(ffmpegProcess.stdin);

    return ffmpegProcess;
}

// ===============================
// BOT READY
// ===============================

client.once("ready", () => {
    console.log("-----------------------------------");
    console.log("🤖 YURI BOT");
    console.log("-----------------------------------");
    console.log(`Logged in as ${client.user.tag}`);
    console.log("Bot is ready.");
    console.log("-----------------------------------");
});

// ===============================
// MESSAGE HANDLER
// ===============================

client.on("messageCreate", async (message) => {

    // Ignore other bots
    if (message.author.bot) return;

    // Ignore messages without prefix
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command = args.shift().toLowerCase();

    // ===============================
    // !HELLO
    // ===============================

    if (command === "hello") {
        await message.reply("Hello! 👋");
        return;
    }

    // ===============================
    // !PING
    // ===============================

    if (command === "ping") {
        await message.reply(`🏓 Pong! ${client.ws.ping}ms`);
        return;
    }

    // ===============================
    // !JOIN
    // ===============================

    if (command === "join") {

        const voiceChannel = message.member?.voice?.channel;

        if (!voiceChannel) {
            await message.reply(
                "❌ You need to join a voice channel first."
            );
            return;
        }

        try {

            if (connection) {
                connection.destroy();
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator
            });

            connection.subscribe(player);

            await message.reply(
                `✅ Joined **${voiceChannel.name}**.`
            );

        } catch (error) {

            console.error("❌ Join error:", error);

            await message.reply(
                "❌ I couldn't join the voice channel."
            );
        }

        return;
    }

    // ===============================
    // !PLAY
    // ===============================

    if (command === "play") {

        const song = args.join(" ").trim();

        if (!song) {
            await message.reply(
                "❌ Please enter a song name.\nExample: `!play Totoong Tayo`"
            );
            return;
        }

        const voiceChannel = message.member?.voice?.channel;

        if (!voiceChannel) {
            await message.reply(
                "❌ You need to join a voice channel first."
            );
            return;
        }

        try {

            // Stop previous audio
            cleanupProcesses();

            // Search SoundCloud
            const result = await searchSoundCloud(song);

            if (!result || !result.url) {
                await message.reply(
                    "❌ I couldn't find that song."
                );
                return;
            }

            // Join voice channel
            if (!connection) {

                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator:
                        voiceChannel.guild.voiceAdapterCreator
                });

            }

            connection.subscribe(player);

            await message.reply(
                `🎵 Playing **${result.title}**`
            );

            // Get yt-dlp stream
            const ytDlpStream = await getAudioStream(
                result.url
            );

            if (!ytDlpStream) {
                throw new Error(
                    "yt-dlp returned an invalid stream."
                );
            }

            // Start FFmpeg
            const ffmpegProcess =
                startFFmpeg(ytDlpStream);

            if (!ffmpegProcess.stdout) {
                throw new Error(
                    "FFmpeg did not provide stdout."
                );
            }

            // Discord audio resource
            const resource = createAudioResource(
                ffmpegProcess.stdout,
                {
                    inputType: StreamType.Raw
                }
            );

            player.play(resource);

            console.log(
                `▶️ Now playing: ${result.title}`
            );

        } catch (error) {

            console.error(
                "❌ Audio error:",
                error
            );

            cleanupProcesses();

            await message.reply(
                `❌ Couldn't play the audio.\n\`${error.message}\``
            );
        }

        return;
    }

    // ===============================
    // !STOP
    // ===============================

    if (command === "stop") {

        try {

            player.stop();

            cleanupProcesses();

            await message.reply(
                "⏹️ Stopped the music."
            );

        } catch (error) {

            console.error("❌ Stop error:", error);

            await message.reply(
                "❌ Failed to stop the music."
            );
        }

        return;
    }

    // ===============================
    // !LEAVE
    // ===============================

    if (command === "leave") {

        try {

            player.stop();

            cleanupProcesses();

            if (connection) {
                connection.destroy();
                connection = null;
            }

            await message.reply(
                "👋 Left the voice channel."
            );

        } catch (error) {

            console.error("❌ Leave error:", error);

            await message.reply(
                "❌ Failed to leave the voice channel."
            );
        }

        return;
    }

    // ===============================
    // !HELP
    // ===============================

    if (command === "help") {

        await message.reply(
            [
                "🎵 **YURI BOT COMMANDS**",
                "",
                "`!hello` - Say hello",
                "`!ping` - Check bot ping",
                "`!join` - Join your voice channel",
                "`!play <song>` - Play a song",
                "`!stop` - Stop music",
                "`!leave` - Leave voice channel",
                "`!help` - Show commands"
            ].join("\n")
        );

        return;
    }
});

// ===============================
// START BOT
// ===============================

async function startBot() {

    try {

        if (!process.env.TOKEN) {
            console.error(
                "❌ TOKEN is missing from environment variables."
            );
            process.exit(1);
        }

        console.log("TOKEN found.");

        await setupYtDlp();

        console.log("Connecting to Discord...");

        await client.login(process.env.TOKEN);

    } catch (error) {

        console.error(
            "❌ Failed to start bot:",
            error
        );

        process.exit(1);
    }
}

startBot();
