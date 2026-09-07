require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

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

let ytDlp;

// =====================================================
// CHECK TOKEN
// =====================================================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    console.error('Add TOKEN to Railway Variables.');
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
// MUSIC PLAYER
// =====================================================

const player = createAudioPlayer();

let currentProcess = null;

player.on('error', error => {
    console.error('❌ Audio player error:', error.message);

    if (currentProcess) {
        try {
            currentProcess.kill();
        } catch (e) {
            console.error('Could not stop yt-dlp process.');
        }

        currentProcess = null;
    }
});

player.on(AudioPlayerStatus.Idle, () => {
    console.log('⏹️ Player is idle.');

    if (currentProcess) {
        try {
            currentProcess.kill();
        } catch (e) {
            // Ignore process cleanup errors
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

        await YTDlpWrap.downloadFromGithub(ytDlpPath);

        console.log('✅ yt-dlp downloaded successfully.');

    } catch (error) {

        console.error(
            '❌ Failed to download yt-dlp:',
            error
        );

        throw error;
    }

    ytDlp = new YTDlpWrap(ytDlpPath);

    console.log('🎵 yt-dlp is ready.');
}

// =====================================================
// BOT READY
// =====================================================

client.once('clientReady', () => {

    console.log(
        '🤖 Logged in as ' + client.user.tag + '!'
    );

    console.log('✅ Bot is ready.');
});

// =====================================================
// SEARCH YOUTUBE
// =====================================================

async function searchYouTube(query) {

    console.log('🔎 Searching YouTube:', query);

    try {

        const searchQuery = 'ytsearch1:' + query;

        const output = await ytDlp.execPromise([
            '--dump-single-json',
            '--flat-playlist',
            '--no-warnings',
            '--no-playlist',
            '--skip-download',
            searchQuery
        ]);

        const result = JSON.parse(output);

        // =================================================
        // SEARCH RESULT WITH ENTRIES
        // =================================================

        if (
            result.entries &&
            result.entries.length > 0
        ) {

            const song = result.entries[0];

            return {
                title: song.title || 'Unknown Song',

                url:
                    song.webpage_url ||
                    song.original_url ||
                    (
                        song.id
                            ? 'https://www.youtube.com/watch?v=' + song.id
                            : null
                    )
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
                    'https://www.youtube.com/watch?v=' + result.id
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

    console.log('🎧 Starting audio stream...');

    if (!ytDlp) {
        throw new Error('yt-dlp is not initialized.');
    }

    const process = ytDlp.exec([
        '-f',
        'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio',

        '--no-playlist',

        '--no-warnings',

        '-o',
        '-',

        url
    ]);

    process.on('error', error => {

        console.error(
            '❌ yt-dlp audio process error:',
            error
        );
    });

    process.on('close', code => {

        if (code !== 0) {

            console.error(
                '❌ yt-dlp exited with code ' + code
            );

        } else {

            console.log(
                '✅ Audio stream finished.'
            );
        }
    });

    return process;
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

client.on('messageCreate', async message => {

    try {

        // =================================================
        // IGNORE BOTS
        // =================================================

        if (message.author.bot) return;

        // =================================================
        // CHECK PREFIX
        // =================================================

        if (!message.content.startsWith(prefix)) {
            return;
        }

        // =================================================
        // PARSE MESSAGE
        // =================================================

        const content = message.content
            .slice(prefix.length)
            .trim();

        if (!content) return;

        const args = content.split(/\s+/);

        const command = args
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

            connection = joinVoiceChannel({

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
                    20_000
                );

                connection.subscribe(player);

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

            if (!voiceChannel) {

                await message.reply(
                    '❌ Join a voice channel first!'
                );

                return;
            }

            const songName =
                args.join(' ');

            if (!songName) {

                await message.reply(
                    '❌ Please enter a song name!\n' +
                    'Example: `!play Totoong Tayo`'
                );

                return;
            }

            const searchingMessage =
                await message.reply(
                    '🔎 Searching for **' +
                    songName +
                    '**...'
                );

            // =================================================
            // STOP PREVIOUS SONG
            // =================================================

            player.stop();

            if (currentProcess) {

                try {
                    currentProcess.kill();
                } catch (e) {
                    // Ignore cleanup error
                }

                currentProcess = null;
            }

            // =================================================
            // SEARCH
            // =================================================

            let song;

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
                    '❌ YouTube search failed. ' +
                    'YouTube may be requiring verification.'
                );

                return;
            }

            if (!song || !song.url) {

                await searchingMessage.edit(
                    '❌ I could not find that song.'
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

            // =================================================
            // CONNECT TO VOICE
            // =================================================

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
                        20_000
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

            connection.subscribe(player);

            // =================================================
            // GET AUDIO
            // =================================================

            try {

                currentProcess =
                    getAudioStream(
                        song.url
                    );

                // Make sure stdout exists
                if (
                    !currentProcess ||
                    !currentProcess.stdout
                ) {

                    throw new Error(
                        'yt-dlp did not provide an audio stream.'
                    );
                }

                const resource =
                    createAudioResource(
                        currentProcess.stdout,
                        {
                            inputType:
                                StreamType.WebmOpus
                        }
                    );

                player.play(resource);

            } catch (error) {

                console.error(
                    '❌ Audio error:',
                    error
                );

                if (currentProcess) {

                    try {
                        currentProcess.kill();
                    } catch (e) {
                        // Ignore cleanup error
                    }

                    currentProcess = null;
                }

                await searchingMessage.edit(
                    '❌ Could not start the audio stream.\n' +
                    'YouTube may be requiring verification.'
                );

                return;
            }

            // =================================================
            // NOW PLAYING
            // =================================================

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
                    // Ignore cleanup error
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
                    // Ignore cleanup error
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

                '**🎵 YURI Music Bot Commands**\n\n' +

                '`!hello` - Say hello\n' +

                '`!ping` - Check if bot is online\n' +

                '`!join` - Join your voice channel\n' +

                '`!play <song>` - Play music\n' +

                '`!stop` - Stop music\n' +

                '`!leave` - Leave voice channel'
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
                '❌ Something went wrong. Check the Railway logs.'
            );

        } catch (replyError) {

            console.error(
                '❌ Could not send error message:',
                replyError
            );
        }
    }
});

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
