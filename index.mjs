import dotenv from 'dotenv'; dotenv.config();   // Load Enviroment
import { BaseAPI } from './Gall/BaseAPI.mjs';
import Discord, { ReactionUserManager } from 'discord.js';               // The discord client
import { Gallery } from './Gall/Types.mjs';
import  Enmap from 'enmap';
import log4js from 'log4js';

log4js.configure({
    appenders: { 
        file: { 
            type: "file", 
            filename: "bot.log"
        },
        console: {
            type: 'console' ,
        }
    },
    categories: { 
        default: { 
            appenders: ["console", "file"], 
            level: "debug" 
        } 
    }
});

const logger = log4js.getLogger("default");

/*
TODO:
    - a mode where it just links a gallery
    - store the original image -> gallery link so i can listen to those reactions
    - tidy code so the processing is in a neater section and generic
    - Handle DMS. That should also upload
*/

const gall          = new BaseAPI(`${process.env.GALL_URL}api`, process.env.GALL_TOKEN, logger);
const discord       = new Discord.Client();
const userLock = {};
const ownerId       = process.env.OWNER_ID || '130973321683533824';

const galleryMessages  = new Enmap({
    name: "galleries",
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep'
});

discord.settings = new Enmap({
    name: "settings",
    fetchAll: false,
    autoFetch: true,
    cloneLevel: 'deep'
});

const defaultSettings = {
    prefix: "$",
    flameReact: true,
    postGallery: true,
    embedGallery: true,
    supressEmbeds: true,
    channel: ''
}

/** When the bot is first ready, lets try and publish all the guilds we are in */
discord.on('ready', async () => {
    logger.debug('bot is ready 🤖');
    for(let k of discord.guilds.cache) {
        const emojis = k[1].emojis.cache.array();
        const result = await gall.updateGuild(k[0], k[1].name, emojis);
        if (result == null) { gall.addGuild(k[0]); }
    }
});

/** When we have a message, look for links on the message */
discord.on('message', async (msg) => {

    //Bots are naughty, i dont like em
    if(msg.author.bot) return;

    if (msg.guild != null) {
        //Prepare the conf and process any commands
        const conf = discord.settings.ensure(msg.guild.id, defaultSettings);
        if (msg.content.indexOf(conf.prefix) === 0) {
            await processMessageCommand(conf.prefix, msg);
            return;
        }
    }

    //Process image uploads if its a DM or its the correct cohannel
    if (msg.guild == null || msg.channel.id == discord.settings.get(msg.guild.id, 'channel')) {
        await processMessageUpload(msg);
        return;
    }
});

/** Processes a message and try to execute commands found in it. */
async function processMessageCommand(prefix, message) {
    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();
    switch(command) {
        default: break;
        case 'setconf': 
            // Then we'll exit if the user is not admin
            if(message.author.id != ownerId) {
                await message.reply("You're not the owner, sorry!");
                return;
            }
            

            // Let's get our key and value from the arguments. 
            // This is array destructuring, by the way. 
            const [prop, ...value] = args;
            // Example: 
            // prop: "prefix"
            // value: ["+"]
            // (yes it's an array, we join it further down!)

            // We can check that the key exists to avoid having multiple useless, 
            // unused keys in the config:
            if(!discord.settings.has(message.guild.id, prop))
                await message.reply("This key is not in the configuration.");
            

            // Now we can finally change the value. Here we only have strings for values 
            // so we won't bother trying to make sure it's the right type and such. 
            discord.settings.set(message.guild.id, value.join(" "), prop);

            // We can confirm everything's done to the client.
            await message.channel.send(`Guild configuration item ${prop} has been changed to:\n\`${value.join(" ")}\``);
            break;
    }
}

/** Processes a message and try to upload any images found in it */
async function processMessageUpload(msg) {

    //See if it is a gallery post.
    // If so, then we will just react and then continue on. No need to process it twice.
    // (this is if they directly post a https://gall.lu.je/gallery/ post)
    let gallery = await findGalleryFromMessageContent(msg.content);
    if (gallery != null) {
        msg.react('🔥');
        return;
    }

    //Do not process this message if the user is already being processed.
    // This is required for the attachment collection later on.
    if (userLock[msg.author.id]) return;
    userLock[msg.author.id] = true;


    //Find any links
    const regexp = /(https?:\/\/)?([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b)([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)?/ig;
    let matches;
    let links = [];
    while((matches = regexp.exec(msg.content)) !== null)
        links.push((matches[1] ?? 'https://') + matches[2] + matches[3]);
    
    //Waiting reaction
    let reaction = null;

    //Prepare a list of messages that were used to trigger this.
    // We will allow the user to react to any one of these. 
    // There is multiple because of the attachment listener
    let messages = [ msg ];

    //Add all the attachments
    let hasAtLeastOneAttachment = false;
    msg.attachments.forEach((key, value) => {
        hasAtLeastOneAttachment = true;
        links.push(key.url);
    });

    //Wait for more attachments
    if (hasAtLeastOneAttachment) {
        try {
            //Processing indicator
            if (reaction != null) reaction = await msg.react('🕑');
            await new Promise((resolve, reject) => {
                let timeout = setTimeout(() => { clearTimeout(timeout); reject(`Exceeded time limit.`); }, 2500);
                let listener = (message) => {
                    if (message.author.id === msg.author.id) {
                        if (message.attachments.size > 0 && message.channel.id == msg.channel.id) {
                            message.attachments.forEach((key, value) => { links.push(key.url); });                  //Push the URL
                            setTimeout(() => { clearTimeout(timeout); reject(`Exceeded time limit.`); }, 1000);     //Reset the timeout
                            messages.push(message);
                        } else {
                            discord.removeListener('message', listener);
                            resolve();
                        }
                    }
                }
                discord.on('message', listener);
            });
        }catch(e) {
            /** do nothing, we dont care we failed */
        }
    }

    //We done now, abort the lock
    userLock[msg.author.id] = false;

    //Nothing left here
    if (links.length == 0) {
        if (reaction != null) await reaction.remove();
        return;
    }

    try {
        //Processing indicator
        if (reaction != null) reaction = await msg.react('🕑');

        //Publish the image and set the results in the cache so in the future we can look it up faster
        if (msg.guild)  gallery = await gall.actAs(msg.author.id).publish(links, msg.guild.id, msg.channel.id, msg.id);
        else            gallery = await gall.actAs(msg.author.id).publish(links);

        //Store previous messages
        for(let i in messages) 
            galleryMessages.set("messages", messages[i].id, gallery ? gallery.id : null);

        //Supress the embed for admins
        if (msg.guild != null && discord.settings.get(msg.guild.id, 'supressEmbeds'))
            msg.suppressEmbeds(true);

        //Attempt to post the gallery message
        if (gallery && (msg.guild == null)) { // || discord.settings.get(msg.guild.id, 'postGallery'))) {
            await postGallery(msg.channel, gallery);

        } else {
            if (!channel.guild || discord.settings.get(channel.guild.id, 'flameReact'))
                await message.react('🔥');
        }
        
    }catch(error) {
        
        //We failed to upload
        //await msg.react('❌');
        console.error('Upload Failure', error);
    
    } finally {
    
        //Finally remove the reaction
        if (reaction != null) await reaction.remove();
    
    }
}

/** React to the gall images */
discord.on('raw', async (packet) => {
    if (packet.t === 'MESSAGE_REACTION_ADD' || packet.t === 'MESSAGE_REACTION_REMOVE') {
        
        /** If its not a reaction add, then its a remove :3 */
        const isReactionAdd = packet.t === 'MESSAGE_REACTION_ADD';

        //Validate we are not a bot
        const reactionEvent = packet.d;
        if (reactionEvent.member && reactionEvent.member.user && reactionEvent.member.user.bot) return;
        
        //Set who we are acting as and check the galleries
        gall.actAs(reactionEvent.user_id);
        let gallery = await findGallery(reactionEvent.message_id, reactionEvent.channel_id);
        if (gallery == null) return;
        
        //If its a fire, then we will do seperate things
        if (reactionEvent.emoji.name === '🔥' || reactionEvent.emoji.name === '🔖' || reactionEvent.emoji.name === '👀') {
            //Favourite the gallery
            if (isReactionAdd)  await gall.favourite(gallery);
            else                await gall.unfavourite(gallery);
        } else if (reactionEvent.emoji.name === '📌' || reactionEvent.emoji.name === '📍') { 
            //Set the pin state of the gallery
            if (isReactionAdd)  await gall.pin(gallery);
        } else {
            //Set the reaction of the gallery
            if (isReactionAdd)  await gall.addReaction(gallery, reactionEvent.emoji);
            else                await gall.removeReaction(gallery, reactionEvent.emoji);
        }
    }
});

/** When we join or leave a guild, we should tell GALL */
discord.on("guildUpdate", async (guild) => { await gall.addGuild(guild.id); });
discord.on("guildDelete", async (guild) => { await gall.removeGuild(guild.id); });

/** If a guild creates, updates or deletes a emoji we need to update gall so it can modify the reactions */
discord.on('emojiCreate', async (emoji) => {
    await gall.createEmoji({ 
        guild_id: emoji.guild.id,
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated 
    });
});
discord.on('emojiDelete', async (emoji) => { await gall.deleteEmoji(emoji.id); });
discord.on('emojiUpdate', async (oldEmoji, emoji) => {
    await gall.updateEmoji({ 
        id: emoji.id, 
        name: emoji.name,
        animated: emoji.animated 
    });
});

/** Sends the gallery in the given channel
 * @param {Discord.TextChannel} channel the discord channel
 * @param {Gallery} gallery the gallery
 */
async function postGallery(channel, gallery) {
    logger.debug('posting', gallery);

    let content = `${process.env.GALL_URL}gallery/${gallery.id}/`;
    
    if (!channel.guild || !discord.settings.get(channel.guild.id, 'embedGallery'))
        content = `<${content}>`;

    //Post a new image
    let message = await channel.send(content);

    if (!channel.guild || discord.settings.get(channel.guild.id, 'flameReact'))
        message.react('🔥');

    //Store it in the cache
    galleryMessages.set("messages", message.id, gallery.id);

    //Return the message
    return message;
}


/** Finds a gallery from the given message id. If the message isn't cached, the it will be found using the given channel id. */
async function findGallery(message_id, channel_id) {

    //If its not in the cache, lets see if we can find it from the API
    if (!galleryMessages.has("messages", message_id)) {
        let gallery = null;
        
        //Find the galleries in the API
        const galleries = await gall.findGalleries(message_id);
        if (galleries.length > 0) {
            gallery = galleries[0];
        } else {
            
            //Find the gallery from the message content
            const channel = await discord.channels.fetch(channel_id);
            if (channel) {
                const message = await channel.messages.fetch(message_id);
                if (message && message.content) {
                    gallery = await findGalleryFromMessageContent(message.content);
                }
            }
        }

        //Set the cache
        galleryMessages.set("messages", message_id, gallery.id);
        return gallery;
    }
    
    //Finally return the cached value
    const galleryId = galleryMessages.get("messages", message_id);
    return await gall.getGallery(galleryId);
}

/** Finds a gallery from the given content, looking for existing GALL urls */
async function findGalleryFromMessageContent(content) {
    let uriIndex = content.indexOf(process.env.GALL_URL);
    if (uriIndex >= 0) {
        //Search from that point onwards for a GALL specific pattern (/gallery/id/)
        // If we find a matching gallery, we will fetch it from the API and store that
        const subcontent = content.substr(uriIndex);
        const regex = /gallery\/(\d*)\/?/;
        const matches = subcontent.match(regex);
        if (!matches) return null;
        return await gall.getGallery(matches[1]);
    }

    return null;
}

discord.login(process.env.BOT_TOKEN);