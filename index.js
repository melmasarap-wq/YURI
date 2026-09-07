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
const path = require('path');

// =====================================================
// SETTINGS
// =====================================================

const prefix = '!';

const ytDlpPath = path.join(__dirname, 'yt-dlp');

let ytDlp = null;
let currentProcess = null;

// =====================================================
// CHECK TOKEN
// =====================================================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    console.error('Please add TOKEN to Railway Variables.');
    process.exit(1);
}

console.log('🔑 TOKEN found.');

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

player.on('error', error => {

    console.error(
        '❌ Audio player error:',
        error
    );

    if (currentProcess) {
        try {
            currentProcess.kill();
        } catch (e) {
            console.error(
                '⚠️ Could not stop yt-dlp process.'
            );
        }

        currentProcess = null;
    }
});

player.on(AudioPlayerStatus.Idle, () => {

    console.log('⏹️ Audio player is idle.');

    if (currentProcess) {

        try {
            currentProcess.kill();
        } catch (e) {
            // Ignore cleanup error
        }

        currentProcess = null;
    }
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
// SEARCH YOUTUBE
// =====================================================

async function searchYouTube(query) {

    console.log(
        '🔎 Searching YouTube:',
        query
    );

    try {

        const searchQuery =
            'ytsearch1:' + query;

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
                (
                    song.id
                        ? 'https://www.youtube.com/watch?v=' +
                          song.id
                        : null
                );

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

            return {

                title:
                    result.title ||
                    'Unknown Song',

                url:
                    result.webpage_url ||
                    result.original_url ||
                    'https://www.youtube.com/watch?v=' +
                    result.id
            };
        }

        return null;

    } catch (error) {

        console.error(
            '❌ YouTube search error:',
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

    const process =
        ytDlp.exec([
            '-f',

            'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio',

            '--no-playlist',

            '--no-warnings',

            '-o',

            '-',

            url
        ]);

    // =================================================
    // PROCESS ERROR
    // =================================================

    process.on('error', error => {

        console.error(
            '❌ yt-dlp process error:'
        );

        console.error(error);
    });

    // =================================================
    // STDERR
    // =================================================

    if (process.stderr) {

        process.stderr.on(
            'data',
            data => {

                const errorText =
                    data.toString().trim();

                if (errorText) {

                    console.error(
                        '❌ yt-dlp:',
                        errorText
                    );
                }
            }
        );
    }

    // =================================================
    // PROCESS CLOSE
    // =================================================

    process.on(
        'close',
        code => {

            console.log(
                '🎵 yt-dlp process closed with code:',
                code
            );

            if (code !== 0) {

                console.error(
                    '❌ yt-dlp failed to download audio.'
                );
            } else {

                console.log(
                    '✅ yt-dlp audio process finished.'
                );
            }
        }
    );

    return process;
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
                            message.guild.voiceAdapterCreator
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
                // SEARCHING MESSAGE
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

                if (currentProcess) {

                    try {
                        currentProcess.kill();
                    } catch (e) {
                        // Ignore
                    }

                    currentProcess = null;
                }

                // -------------------------------------------------
                // SEARCH SONG
                // -------------------------------------------------

                let song = null;

                try {

                    song =
                        await searchYouTube(
                            songName
                        );

                } catch (error) {

                    console.error(
                        '❌ Search failed:',
                        error
                    );

                    await searchingMessage.edit(
                        '❌ YouTube search failed.'
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
                                message.guild.voiceAdapterCreator
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

                connection.subscribe(
                    player
                );

                // -------------------------------------------------
                // START AUDIO
                // -------------------------------------------------

                try {

                    currentProcess =
                        getAudioStream(
                            song.url
                        );

                    // -------------------------------------------------
                    // CHECK PROCESS
                    // -------------------------------------------------

                    if (!currentProcess) {

                        throw new Error(
                            'yt-dlp process was not created.'
                        );
                    }

                    // -------------------------------------------------
                    // CHECK STDOUT
                    // -------------------------------------------------

                    if (!currentProcess.stdout) {

                        throw new Error(
                            'yt-dlp did not provide an audio stream.'
                        );
                    }

                    console.log(
                        '🎧 Audio stream received.'
                    );

                    // -------------------------------------------------
                    // CREATE AUDIO RESOURCE
                    // -------------------------------------------------

                    const resource =
                        createAudioResource(
                            currentProcess.stdout,
                            {
                                inputType:
                                    StreamType.WebmOpus
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

                    if (currentProcess) {

                        try {
                            currentProcess.kill();
                        } catch (e) {
                            // Ignore
                        }

                        currentProcess = null;
                    }

                    await searchingMessage.edit(
                        '❌ Could not start audio.\n' +
                        'Check the Railway logs for the yt-dlp error.'
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

            // =================================================
            // !STOP
            // =================================================

            if (command === 'stop') {

                player.stop();

                if (currentProcess) {

                    try {
                        currentProcess.kill();
                    } catch (e) {
                        // Ignore
                    }

                    currentProcess = null;
                }

                await message.reply(
                    '⏹️ Music stopped!'
                );

                return;
            }

            // =================================================
            // !LEAVE
            // =================================================

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

                if (currentProcess) {

                    try {
                        currentProcess.kill();
                    } catch (e) {
                        // Ignore
                    }

                    currentProcess = null;
                }

                connection.destroy();

                await message.reply(
                    '👋 Left the voice channel!'
                );

                return;
            }

            // =================================================
            // !HELP
            // =================================================

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
