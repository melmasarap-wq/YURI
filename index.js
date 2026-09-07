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

const YTDlpWrap =
    require('yt-dlp-wrap').default ||
    require('yt-dlp-wrap');

const prefix = '!';

// Use Railway's installed yt-dlp
const ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';

let ytDlp = null;

// Playback control
let playbackId = 0;
let currentProcess = null;
let currentGuildId = null;

// Check TOKEN
if (!process.env.TOKEN) {
    console.error('TOKEN is missing!');
    console.error('Add TOKEN to Railway Variables.');
    process.exit(1);
}

console.log('TOKEN found.');

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Audio player
const player = createAudioPlayer();

player.on(AudioPlayerStatus.Playing, () => {
    console.log('Player is playing.');
});

player.on(AudioPlayerStatus.Idle, () => {
    console.log('Player is idle.');
});

player.on('error', error => {
    console.error('Audio player error:', error);
});

// Stop currently playing audio
function stopCurrentAudio() {
    if (currentProcess) {
        try {
            console.log('Stopping previous yt-dlp process...');
            currentProcess.kill();
        } catch (error) {
            console.log('Previous yt-dlp process was already stopped.');
        }

        currentProcess = null;
    }

    try {
        player.stop();
    } catch (error) {
        // Ignore player stop errors
    }
}

// Setup yt-dlp
async function setupYtDlp() {
    console.log('Setting up yt-dlp...');

    try {
        ytDlp = new YTDlpWrap(ytDlpPath);

        const version = await ytDlp.execPromise([
            '--version'
        ]);

        // Avoid template literal syntax issue
        console.log(
            'yt-dlp is ready. Version: ' + version.trim()
        );

    } catch (error) {
        console.error(
            'Failed to start yt-dlp:',
            error
        );

        throw error;
    }
}

// Discord ready
client.once('clientReady', () => {
    console.log(
        'Logged in as ' + client.user.tag + '!'
    );

    console.log('Bot is ready.');
});

// Search YouTube
async function searchYouTube(query) {
    console.log(
        'Searching YouTube: ' + query
    );

    try {
        const output = await ytDlp.execPromise([
            '--dump-single-json',
            '--flat-playlist',
            '--no-warnings',
            '--no-playlist',
            '--skip-download',
            'ytsearch1:' + query
        ]);

        if (!output) {
            return null;
        }

        const result = JSON.parse(output);

        if (
            result.entries &&
            result.entries.length > 0
        ) {
            const song = result.entries[0];

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
                title: song.title || 'Unknown Song',
                url: url
            };
        }

        if (result.id) {
            return {
                title: result.title || 'Unknown Song',
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
            'YouTube search error:',
            error
        );

        throw error;
    }
}

// Create audio stream
function getAudioStream(url) {
    console.log('Starting audio stream...');

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
            'yt-dlp audio error:',
            error
        );
    });

    process.on('close', code => {
        console.log(
            'yt-dlp process closed with code ' + code
        );
    });

    return process;
}

// Commands
client.on('messageCreate', async message => {
    try {

        // Ignore bot messages
        if (message.author.bot) {
            return;
        }

        // Ignore messages without prefix
        if (!message.content.startsWith(prefix)) {
            return;
        }

        const content =
            message.content
                .slice(prefix.length)
                .trim();

        if (!content) {
            return;
        }

        const args = content.split(/\s+/);

        const command =
            args.shift().toLowerCase();

        console.log(
            message.author.tag +
            ': ' +
            message.content
        );

        // =========================
        // HELLO
        // =========================
        if (command === 'hello') {

            await message.reply(
                'Hello! 👋'
            );

            return;
        }

        // =========================
        // PING
        // =========================
        if (command === 'ping') {

            await message.reply(
                'Pong! 🏓'
            );

            return;
        }

        // =========================
        // JOIN
        // =========================
        if (command === 'join') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {

                await message.reply(
                    'Join a voice channel first!'
                );

                return;
            }

            let connection =
                getVoiceConnection(
                    message.guild.id
                );

            if (connection) {

                await message.reply(
                    'I am already in a voice channel! 🎵'
                );

                return;
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator:
                    message.guild.voiceAdapterCreator
            });

            try {

                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    20000
                );

                connection.subscribe(player);

                currentGuildId =
                    message.guild.id;

                await message.reply(
                    'Joined the voice channel! 🎵'
                );

            } catch (error) {

                console.error(
                    'Voice connection error:',
                    error
                );

                connection.destroy();

                await message.reply(
                    'Could not join the voice channel.'
                );
            }

            return;
        }

        // =========================
        // PLAY
        // =========================
        if (command === 'play') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {

                await message.reply(
                    'Join a voice channel first!'
                );

                return;
            }

            const songName =
                args.join(' ').trim();

            if (!songName) {

                await message.reply(
                    'Please enter a song name!\n' +
                    'Example: `!play Totoong Tayo`'
                );

                return;
            }

            // Create a NEW playback ID
            playbackId++;

            const thisPlayback =
                playbackId;

            console.log(
                'New playback request #' +
                thisPlayback +
                ': ' +
                songName
            );

            // Stop previous song immediately
            stopCurrentAudio();

            const searchingMessage =
                await message.reply(
                    'Searching for **' +
                    songName +
                    '**... 🔎'
                );

            let song;

            // Search
            try {

                song =
                    await searchYouTube(
                        songName
                    );

            } catch (error) {

                // Ignore old request
                if (
                    thisPlayback !==
                    playbackId
                ) {

                    console.log(
                        'Ignoring old search request #' +
                        thisPlayback
                    );

                    return;
                }

                await searchingMessage.edit(
                    'YouTube search failed. Check Railway logs.'
                );

                return;
            }

            // IMPORTANT:
            // If another !play happened,
            // this request is now OLD.
            if (
                thisPlayback !==
                playbackId
            ) {

                console.log(
                    'Ignoring old song: ' +
                    (song?.title || songName)
                );

                return;
            }

            if (
                !song ||
                !song.url
            ) {

                await searchingMessage.edit(
                    'I could not find that song.'
                );

                return;
            }

            console.log(
                'Found: ' + song.title
            );

            console.log(
                'URL: ' + song.url
            );

            // Get existing connection
            let connection =
                getVoiceConnection(
                    message.guild.id
                );

            // Join if not connected
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
                        'Voice connection error:',
                        error
                    );

                    connection.destroy();

                    if (
                        thisPlayback ===
                        playbackId
                    ) {

                        await searchingMessage.edit(
                            'Could not join the voice channel.'
                        );
                    }

                    return;
                }
            }

            // Check AGAIN before starting audio
            if (
                thisPlayback !==
                playbackId
            ) {

                console.log(
                    'Request #' +
                    thisPlayback +
                    ' became old before audio start.'
                );

                return;
            }

            connection.subscribe(player);

            try {

                // Start yt-dlp
                const process =
                    getAudioStream(
                        song.url
                    );

                // Check again
                if (
                    thisPlayback !==
                    playbackId
                ) {

                    console.log(
                        'Killing old audio request #' +
                        thisPlayback
                    );

                    try {
                        process.kill();
                    } catch (error) {}

                    return;
                }

                currentProcess =
                    process;

                if (!process.stdout) {
                    throw new Error(
                        'yt-dlp did not provide stdout.'
                    );
                }

                console.log(
                    'yt-dlp stdout received.'
                );

                // Create Discord audio resource
                const resource =
                    createAudioResource(
                        process.stdout,
                        {
                            inputType:
                                StreamType.WebmOpus
                        }
                    );

                // Final check
                if (
                    thisPlayback !==
                    playbackId
                ) {

                    console.log(
                        'Request #' +
                        thisPlayback +
                        ' cancelled before playback.'
                    );

                    try {
                        process.kill();
                    } catch (error) {}

                    return;
                }

                // PLAY
                player.play(resource);

                currentGuildId =
                    message.guild.id;

                console.log(
                    'Now playing request #' +
                    thisPlayback +
                    ': ' +
                    song.title
                );

                await searchingMessage.edit(
                    'Now playing: **' +
                    song.title +
                    '** 🎵'
                );

                // Clear process only if
                // this is still the current process
                process.on('close', () => {

                    if (
                        currentProcess ===
                        process
                    ) {

                        currentProcess =
                            null;
                    }
                });

            } catch (error) {

                console.error(
                    'Audio error:',
                    error
                );

                // Ignore errors from old songs
                if (
                    thisPlayback !==
                    playbackId
                ) {

                    console.log(
                        'Ignoring error from old request #' +
                        thisPlayback
                    );

                    return;
                }

                if (currentProcess) {

                    try {
                        currentProcess.kill();
                    } catch (error) {}

                    currentProcess = null;
                }

                await searchingMessage.edit(
                    'Could not start the music.'
                );

                return;
            }

            return;
        }

        // =========================
        // STOP
        // =========================
        if (command === 'stop') {

            // Invalidate old playback
            playbackId++;

            console.log(
                'Stopping music. New playback ID: ' +
                playbackId
            );

            stopCurrentAudio();

            await message.reply(
                'Music stopped! ⏹️'
            );

            return;
        }

        // =========================
        // LEAVE
        // =========================
        if (command === 'leave') {

            // Invalidate old playback
            playbackId++;

            console.log(
                'Leaving voice channel. New playback ID: ' +
                playbackId
            );

            stopCurrentAudio();

            const connection =
                getVoiceConnection(
                    message.guild.id
                );

            if (!connection) {

                await message.reply(
                    'I am not in a voice channel!'
                );

                return;
            }

            connection.destroy();

            if (
                currentGuildId ===
                message.guild.id
            ) {

                currentGuildId = null;
            }

            await message.reply(
                'Left the voice channel! 👋'
            );

            return;
        }

        // =========================
        // HELP
        // =========================
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
            'Command error:',
            error
        );

        try {

            await message.reply(
                'Something went wrong. Check the Railway logs.'
            );

        } catch (replyError) {

            console.error(
                'Could not send error message:',
                replyError
            );
        }
    }
});

// =========================
// START BOT
// =========================

async function startBot() {

    try {

        await setupYtDlp();

        console.log(
            'Logging into Discord...'
        );

        await client.login(
            process.env.TOKEN
        );

        console.log(
            'Discord login successful.'
        );

    } catch (error) {

        console.error(
            'Startup error:',
            error
        );

        process.exit(1);
    }
}

startBot();
