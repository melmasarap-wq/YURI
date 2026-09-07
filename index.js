require('dotenv').config();

const {
    Client,
    GatewayIntentBits
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection,
    StreamType,
    AudioPlayerStatus
} = require('@discordjs/voice');

const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');

// =====================================================
// SETTINGS
// =====================================================

const prefix = '!';
const ytDlpPath = path.join(__dirname, 'yt-dlp');

let ytDlp = null;

// Stores both yt-dlp and ffmpeg processes
let currentProcesses = null;

// =====================================================
// CHECK TOKEN
// =====================================================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    console.error('Add TOKEN to Railway Variables.');
    process.exit(1);
}

console.log('🔑 TOKEN found.');

if (!ffmpegPath) {
    console.error('❌ FFmpeg was not found.');
    process.exit(1);
}

console.log('🎬 FFmpeg found.');

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// =====================================================
// AUDIO PLAYER
// =====================================================

const player = createAudioPlayer();

// =====================================================
// STOP AUDIO PROCESSES
// =====================================================

function stopAudioProcesses() {

    if (!currentProcesses) {
        return;
    }

    try {
        if (currentProcesses.ytDlp) {
            currentProcesses.ytDlp.kill();
        }
    } catch (error) {
        console.error('⚠️ Could not stop yt-dlp.');
    }

    try {
        if (currentProcesses.ffmpeg) {
            currentProcesses.ffmpeg.kill();
        }
    } catch (error) {
        console.error('⚠️ Could not stop FFmpeg.');
    }

    currentProcesses = null;
}

// =====================================================
// PLAYER ERROR
// =====================================================

player.on('error', error => {

    console.error('❌ Audio player error:', error);

    stopAudioProcesses();
});

// =====================================================
// PLAYER IDLE
// =====================================================

player.on(AudioPlayerStatus.Idle, () => {

    console.log('⏹️ Audio player is idle.');

    stopAudioProcesses();
});

// =====================================================
// SETUP YT-DLP
// =====================================================

async function setupYtDlp() {

    console.log('⬇️ Setting up yt-dlp...');

    try {

        await YTDlpWrap.downloadFromGithub(
            ytDlpPath
        );

        console.log(
            '✅ yt-dlp downloaded successfully.'
        );

    } catch (error) {

        console.error(
            '❌ Failed to download yt-dlp:',
            error
        );

        throw error;
    }

    ytDlp = new YTDlpWrap(
        ytDlpPath
    );

    console.log(
        '🎵 yt-dlp is ready.'
    );
}

// =====================================================
// DISCORD READY
// =====================================================

client.once('clientReady', () => {

    console.log(
        '🤖 Logged in as ' +
        client.user.tag +
        '!'
    );

    console.log(
        '✅ Bot is ready.'
    );
});

// =====================================================
// SEARCH SOUNDCLOUD
// =====================================================

async function searchSoundCloud(query) {

    console.log(
        '🔎 Searching SoundCloud:',
        query
    );

    if (!ytDlp) {
        throw new Error(
            'yt-dlp is not initialized.'
        );
    }

    try {

        const searchQuery =
            'scsearch1:' + query;

        const output =
            await ytDlp.execPromise([
                '--dump-single-json',
                '--flat-playlist',
                '--no-warnings',
                '--no-playlist',
                '--skip-download',
                searchQuery
            ]);

        if (!output) {

            throw new Error(
                'yt-dlp returned an empty result.'
            );
        }

        const result =
            JSON.parse(output);

        // =================================================
        // SEARCH RESULT
        // =================================================

        if (
            result.entries &&
            result.entries.length > 0
        ) {

            const song =
                result.entries[0];

            const url =
                song.webpage_url ||
                song.original_url ||
                song.url;

            if (!url) {
                return null;
            }

            return {
                title:
                    song.title ||
                    'Unknown Song',

                url: url
            };
        }

        // =================================================
        // DIRECT RESULT
        // =================================================

        if (result.id) {

            const url =
                result.webpage_url ||
                result.original_url ||
                result.url;

            if (!url) {
                return null;
            }

            return {
                title:
                    result.title ||
                    'Unknown Song',

                url: url
            };
        }

        return null;

    } catch (error) {

        console.error(
            '❌ SoundCloud search error:',
            error
        );

        throw error;
    }
}

// =====================================================
// GET AUDIO STREAM
// =====================================================

function getAudioStream(url) {

    console.log(
        '🎧 Starting audio stream...'
    );

    console.log(
        '🔗 Audio URL:',
        url
    );

    if (!ytDlp) {

        throw new Error(
            'yt-dlp is not initialized.'
        );
    }

    // =================================================
    // START YT-DLP
    // =================================================

    const ytProcess =
        ytDlp.exec([
            '-f',
            'bestaudio/best',

            '--no-playlist',

            '--no-warnings',

            '--quiet',

            '-o',
            '-',

            url
        ]);

    // =================================================
    // START FFMPEG
    // =================================================

    const ffmpegProcess =
        spawn(
            ffmpegPath,
            [
                '-hide_banner',
                '-loglevel',
                'error',

                '-i',
                'pipe:0',

                '-f',
                's16le',

                '-ar',
                '48000',

                '-ac',
                '2',

                'pipe:1'
            ],
            {
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            }
        );

    // =================================================
    // CONNECT YT-DLP -> FFMPEG
    // =================================================

    if (!ytProcess.stdout) {

        throw new Error(
            'yt-dlp did not provide stdout.'
        );
    }

    ytProcess.stdout.pipe(
        ffmpegProcess.stdin
    );

    // =================================================
    // YT-DLP ERROR
    // =================================================

    ytProcess.on('error', error => {

        console.error(
            '❌ yt-dlp process error:',
            error
        );

        try {
            ffmpegProcess.kill();
        } catch (e) {}
    });

    // =================================================
    // YT-DLP STDERR
    // =================================================

    if (ytProcess.stderr) {

        ytProcess.stderr.on(
            'data',
            data => {

                const text =
                    data.toString().trim();

                if (text) {

                    console.error(
                        'yt-dlp:',
                        text
                    );
                }
            }
        );
    }

    // =================================================
    // YT-DLP CLOSE
    // =================================================

    ytProcess.on(
        'close',
        code => {

            console.log(
                '🎵 yt-dlp closed:',
                code
            );

            try {

                if (
                    !ffmpegProcess.killed &&
                    code !== 0
                ) {
                    ffmpegProcess.kill();
                }

            } catch (e) {}
        }
    );

    // =================================================
    // FFMPEG ERROR
    // =================================================

    ffmpegProcess.on(
        'error',
        error => {

            console.error(
                '❌ FFmpeg error:',
                error
            );

            try {
                ytProcess.kill();
            } catch (e) {}
        }
    );

    // =================================================
    // FFMPEG STDERR
    // =================================================

    ffmpegProcess.stderr.on(
        'data',
        data => {

            const text =
                data.toString().trim();

            if (text) {

                console.error(
                    'FFmpeg:',
                    text
                );
            }
        }
    );

    // =================================================
    // FFMPEG CLOSE
    // =================================================

    ffmpegProcess.on(
        'close',
        code => {

            console.log(
                '🎬 FFmpeg closed:',
                code
            );
        }
    );

    currentProcesses = {
        ytDlp: ytProcess,
        ffmpeg: ffmpegProcess
    };

    return ffmpegProcess;
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

client.on(
    'messageCreate',
    async message => {

        try {

            // =================================================
            // IGNORE BOTS
            // =================================================

            if (message.author.bot) {
                return;
            }

            // =================================================
            // PREFIX CHECK
            // =================================================

            if (
                !message.content.startsWith(prefix)
            ) {
                return;
            }

            // =================================================
            // PARSE COMMAND
            // =================================================

            const content =
                message.content
                    .slice(prefix.length)
                    .trim();

            if (!content) {
                return;
            }

            const args =
                content.split(/\s+/);

            const command =
                args
                    .shift()
                    .toLowerCase();

            console.log(
                '📩 ' +
                message.author.tag +
                ': ' +
                message.content
            );

            // =================================================
            // !HELLO
            // =================================================

            if (command === 'hello') {

                await message.reply(
                    'Hello! 👋'
                );

                return;
            }

            // =================================================
            // !PING
            // =================================================

            if (command === 'ping') {

                await message.reply(
                    '🏓 Pong!'
                );

                return;
            }

            // =================================================
            // !JOIN
            // =================================================

            if (command === 'join') {

                const voiceChannel =
                    message.member?.voice?.channel;

                if (!voiceChannel) {

                    await message.reply(
                        '❌ Join a voice channel first!'
                    );

                    return;
                }

                let connection =
                    getVoiceConnection(
                        message.guild.id
                    );

                if (connection) {

                    await message.reply(
                        '🎵 I am already in a voice channel!'
                    );

                    return;
                }

                connection =
                    joinVoiceChannel({

                        channelId:
                            voiceChannel.id,

                        guildId:
                            message.guild.id,

                        adapterCreator:
                            message.guild
                                .voiceAdapterCreator
                    });

                try {

                    await entersState(
                        connection,
                        VoiceConnectionStatus.Ready,
                        20000
                    );

                    connection.subscribe(
                        player
                    );

                    await message.reply(
                        '🎵 Joined the voice channel!'
                    );

                } catch (error) {

                    console.error(
                        '❌ Voice connection error:',
                        error
                    );

                    connection.destroy();

                    await message.reply(
                        '❌ Could not join the voice channel.'
                    );
                }

                return;
            }

            // =================================================
            // !PLAY
            // =================================================

            if (command === 'play') {

                const voiceChannel =
                    message.member?.voice?.channel;

                // -------------------------------------------------
                // CHECK VOICE CHANNEL
                // -------------------------------------------------

                if (!voiceChannel) {

                    await message.reply(
                        '❌ Join a voice channel first!'
                    );

                    return;
                }

                // -------------------------------------------------
                // CHECK SONG NAME
                // -------------------------------------------------

                const songName =
                    args.join(' ');

                if (!songName) {

                    await message.reply(
                        '❌ Please enter a song name!\n' +
                        'Example: `!play Totoong Tayo`'
                    );

                    return;
                }

                // -------------------------------------------------
                // SEARCHING
                // -------------------------------------------------

                const searchingMessage =
                    await message.reply(
                        '🔎 Searching for **' +
                        songName +
                        '**...'
                    );

                // -------------------------------------------------
                // STOP CURRENT SONG
                // -------------------------------------------------

                player.stop();

                stopAudioProcesses();

                // -------------------------------------------------
                // SEARCH
                // -------------------------------------------------

                let song = null;

                try {

                    song =
                        await searchSoundCloud(
                            songName
                        );

                } catch (error) {

                    console.error(
                        '❌ Search failed:',
                        error
                    );

                    await searchingMessage.edit(
                        '❌ SoundCloud search failed.'
                    );

                    return;
                }

                // -------------------------------------------------
                // SONG NOT FOUND
                // -------------------------------------------------

                if (
                    !song ||
                    !song.url
                ) {

                    await searchingMessage.edit(
                        '❌ Song not found.'
                    );

                    return;
                }

                console.log(
                    '🎵 Found:',
                    song.title
                );

                console.log(
                    '🔗 URL:',
                    song.url
                );

                // -------------------------------------------------
                // CONNECT TO VOICE
                // -------------------------------------------------

                let connection =
                    getVoiceConnection(
                        message.guild.id
                    );

                if (!connection) {

                    connection =
                        joinVoiceChannel({

                            channelId:
                                voiceChannel.id,

                            guildId:
                                message.guild.id,

                            adapterCreator:
                                message.guild
                                    .voiceAdapterCreator
                        });

                    try {

                        await entersState(
                            connection,
                            VoiceConnectionStatus.Ready,
                            20000
                        );

                    } catch (error) {

                        console.error(
                            '❌ Voice connection error:',
                            error
                        );

                        connection.destroy();

                        await searchingMessage.edit(
                            '❌ Could not join the voice channel.'
                        );

                        return;
                    }
                }

                // -------------------------------------------------
                // SUBSCRIBE PLAYER
                // -------------------------------------------------

                connection.subscribe(
                    player
                );

                // -------------------------------------------------
                // START AUDIO
                // -------------------------------------------------

                try {

                    const ffmpegProcess =
                        getAudioStream(
                            song.url
                        );

                    if (
                        !ffmpegProcess ||
                        !ffmpegProcess.stdout
                    ) {

                        throw new Error(
                            'FFmpeg did not provide an audio stream.'
                        );
                    }

                    console.log(
                        '🎧 Audio stream received.'
                    );

                    // -------------------------------------------------
                    // CREATE RAW AUDIO RESOURCE
                    // -------------------------------------------------

                    const resource =
                        createAudioResource(
                            ffmpegProcess.stdout,
                            {
                                inputType:
                                    StreamType.Raw
                            }
                        );

                    // -------------------------------------------------
                    // PLAY
                    // -------------------------------------------------

                    player.play(
                        resource
                    );

                    console.log(
                        '▶️ Player started.'
                    );

                } catch (error) {

                    console.error(
                        '❌ Audio error:',
                        error
                    );

                    stopAudioProcesses();

                    await searchingMessage.edit(
                        '❌ Could not start audio.'
                    );

                    return;
                }

                // -------------------------------------------------
                // NOW PLAYING
                // -------------------------------------------------

                await searchingMessage.edit(
                    '▶️ Now playing: **' +
                    song.title +
                    '** 🎵'
                );

                return;
            }

            // =====================================================
            // !STOP
            // =====================================================

            if (command === 'stop') {

                player.stop();

                stopAudioProcesses();

                await message.reply(
                    '⏹️ Music stopped!'
                );

                return;
            }

            // =====================================================
            // !LEAVE
            // =====================================================

            if (command === 'leave') {

                const connection =
                    getVoiceConnection(
                        message.guild.id
                    );

                if (!connection) {

                    await message.reply(
                        '❌ I am not in a voice channel!'
                    );

                    return;
                }

                player.stop();

                stopAudioProcesses();

                connection.destroy();

                await message.reply(
                    '👋 Left the voice channel!'
                );

                return;
            }

            // =====================================================
            // !HELP
            // =====================================================

            if (command === 'help') {

                await message.reply(
                    '**🎵 YURI BOT COMMANDS**\n\n' +

                    '`!hello` - Say hello\n' +
                    '`!ping` - Check bot status\n' +
                    '`!join` - Join your voice channel\n' +
                    '`!play <song>` - Play music\n' +
                    '`!stop` - Stop music\n' +
                    '`!leave` - Leave voice channel\n' +
                    '`!help` - Show commands'
                );

                return;
            }

        } catch (error) {

            console.error(
                '❌ Command error:',
                error
            );

            try {

                await message.reply(
                    '❌ Something went wrong. Check Railway logs.'
                );

            } catch (replyError) {

                console.error(
                    '❌ Could not send error message:',
                    replyError
                );
            }
        }
    }
);

// =====================================================
// START BOT
// =====================================================

async function startBot() {

    try {

        await setupYtDlp();

        console.log(
            '🔐 Logging into Discord...'
        );

        await client.login(
            process.env.TOKEN
        );

        console.log(
            '🔐 Discord login successful.'
        );

    } catch (error) {

        console.error(
            '❌ Startup error:',
            error
        );

        process.exit(1);
    }
}

// =====================================================
// START
// =====================================================

startBot();
