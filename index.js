require('dotenv').config();

const path = require('path');
const { spawn } = require('child_process');

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
    StreamType
} = require('@discordjs/voice');

const YTDlpWrap = require('yt-dlp-wrap').default;

// ==========================================
// TOKEN
// ==========================================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    process.exit(1);
}

// ==========================================
// YT-DLP
// ==========================================

const ytDlpPath = path.join(
    __dirname,
    'node_modules',
    'yt-dlp-wrap',
    'bin',
    'yt-dlp'
);

console.log('📁 yt-dlp path:', ytDlpPath);

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const prefix = '!';

// ==========================================
// MUSIC PLAYER
// ==========================================

const player = createAudioPlayer();

player.on('error', error => {
    console.error('❌ Audio player error:', error);
});

player.on('stateChange', (oldState, newState) => {
    console.log(
        `🎵 Player: ${oldState.status} → ${newState.status}`
    );
});

// ==========================================
// READY
// ==========================================

client.once('clientReady', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
});

// ==========================================
// YOUTUBE SEARCH
// ==========================================

async function searchYouTube(query) {

    return new Promise((resolve, reject) => {

        const args = [
            '--dump-single-json',
            '--flat-playlist',
            '--no-warnings',
            '--skip-download',
            `ytsearch1:${query}`
        ];

        console.log('🔎 YouTube search:', query);

        const process = spawn(
            ytDlpPath,
            args,
            {
                windowsHide: true
            }
        );

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', data => {
            stdout += data.toString();
        });

        process.stderr.on('data', data => {
            stderr += data.toString();
        });

        process.on('error', error => {
            reject(error);
        });

        process.on('close', code => {

            if (code !== 0) {

                console.error(
                    '❌ yt-dlp search error:',
                    stderr
                );

                return reject(
                    new Error(stderr || `yt-dlp exited with ${code}`)
                );
            }

            try {

                const result = JSON.parse(stdout);

                if (
                    !result.entries ||
                    result.entries.length === 0
                ) {
                    return resolve(null);
                }

                resolve(result.entries[0]);

            } catch (error) {

                console.error(
                    '❌ Could not parse yt-dlp:',
                    stdout
                );

                reject(error);
            }
        });
    });
}

// ==========================================
// GET AUDIO
// ==========================================

function getAudioStream(url) {

    const args = [
        '-f',
        'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '-o',
        '-',
        url
    ];

    console.log('🎧 Starting yt-dlp audio stream...');

    const process = spawn(
        ytDlpPath,
        args,
        {
            windowsHide: true
        }
    );

    process.stderr.on('data', data => {

        const error = data.toString().trim();

        if (error) {
            console.log('yt-dlp:', error);
        }
    });

    process.on('error', error => {
        console.error(
            '❌ yt-dlp process error:',
            error
        );
    });

    process.on('close', code => {
        console.log(
            `🎧 yt-dlp audio process ended: ${code}`
        );
    });

    return process.stdout;
}

// ==========================================
// COMMANDS
// ==========================================

client.on('messageCreate', async message => {

    // Ignore bots
    if (message.author.bot) return;

    // Ignore non-command messages
    if (!message.content.startsWith(prefix)) return;

    // Parse command
    const args = message.content
        .slice(prefix.length)
        .trim()
        .split(/\s+/);

    const command = args.shift()?.toLowerCase();

    if (!command) return;

    try {

        // ==================================
        // HELLO
        // ==================================

        if (command === 'hello') {
            return message.reply('Hello! 👋');
        }

        // ==================================
        // PING
        // ==================================

        if (command === 'ping') {
            return message.reply('🏓 Pong!');
        }

        // ==================================
        // JOIN
        // ==================================

        if (command === 'join') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {
                return message.reply(
                    '❌ Join a voice channel first!'
                );
            }

            let connection =
                getVoiceConnection(message.guild.id);

            if (connection) {
                return message.reply(
                    '🎵 I am already in a voice channel!'
                );
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator:
                    message.guild.voiceAdapterCreator
            });

            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                20_000
            );

            connection.subscribe(player);

            return message.reply(
                '🎵 Joined the voice channel!'
            );
        }

        // ==================================
        // PLAY
        // ==================================

        if (command === 'play') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {
                return message.reply(
                    '❌ Join a voice channel first!'
                );
            }

            const songName = args.join(' ');

            if (!songName) {
                return message.reply(
                    '❌ Please enter a song name!\n' +
                    'Example: `!play Shape of You`'
                );
            }

            const searching =
                await message.reply(
                    `🔎 Searching for **${songName}**...`
                );

            // Search YouTube
            const song =
                await searchYouTube(songName);

            if (!song) {

                return searching.edit(
                    '❌ I could not find that song!'
                );
            }

            const videoUrl =
                song.url ||
                song.webpage_url;

            if (!videoUrl) {

                return searching.edit(
                    '❌ I could not get the YouTube URL.'
                );
            }

            // ==================================
            // VOICE CONNECTION
            // ==================================

            let connection =
                getVoiceConnection(message.guild.id);

            if (!connection) {

                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator:
                        message.guild.voiceAdapterCreator
                });

                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    20_000
                );
            }

            connection.subscribe(player);

            // ==================================
            // AUDIO
            // ==================================

            const audioStream =
                getAudioStream(videoUrl);

            const resource =
                createAudioResource(
                    audioStream,
                    {
                        inputType:
                            StreamType.WebmOpus
                    }
                );

            player.play(resource);

            await searching.edit(
                `▶️ Now playing: **${song.title || songName}**`
            );
        }

        // ==================================
        // STOP
        // ==================================

        else if (command === 'stop') {

            player.stop();

            return message.reply(
                '⏹️ Music stopped!'
            );
        }

        // ==================================
        // LEAVE
        // ==================================

        else if (command === 'leave') {

            const connection =
                getVoiceConnection(message.guild.id);

            if (!connection) {
                return message.reply(
                    '❌ I am not in a voice channel!'
                );
            }

            player.stop();

            connection.destroy();

            return message.reply(
                '👋 Left the voice channel!'
            );
        }

    } catch (error) {

        console.error(
            '❌ Command error:',
            error
        );

        return message.reply(
            '❌ Something went wrong. Check the Railway logs.'
        );
    }
});

// ==========================================
// LOGIN
// ==========================================

client.login(process.env.TOKEN)
    .then(() => {
        console.log('🔐 Login successful.');
    })
    .catch(error => {

        console.error(
            '❌ Discord login failed:',
            error
        );

        process.exit(1);
    });
