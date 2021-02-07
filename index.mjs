import dotenv from 'dotenv'; dotenv.config();   // Load Enviroment
import { BaseAPI } from './Gall/BaseAPI.mjs';
import Discord, { ReactionUserManager } from 'discord.js';               // The discord client
import { Gallery } from './Gall/Types.mjs';
import  Enmap from 'enmap';

const gall          = new BaseAPI(`${process.env.GALL_URL}api`, process.env.GALL_TOKEN);
const discord       = new Discord.Client();
const galleryCache  = new Map();
const userLock = {};
const ownerId       = process.env.OWNER_ID || '130973321683533824';

discord.settings = new Enmap({
    name: "settings",
    fetchAll: false,
    autoFetch: true,
    cloneLevel: 'deep'
});

const defaultSettings = {
    prefix: "$",            
    postGallery: true,//TODO: Impletement this
    embedGallery: true,//TODO: Impletement this
    supressEmbed: true,//TODO: Impletement this
    channel: ''
}

/** When the bot is first ready, lets try and publish all the guilds we are in */
discord.on('ready', async () => {
    console.log('bot is ready 🤖');
    for(let k of discord.guilds.cache) {
        const emojis = k[1].emojis.cache.array();
        const result = await gall.updateGuild(k[0], k[1].name, emojis);
        if (result == null) { gall.addGuild(k[0]); }
    }
});

/** When we have a message, look for links on the message */
discord.on('message', async (msg) => {
    if(!message.guild || message.author.bot) return;

    
    //Process a command
    const conf = discord.settings.ensure(member.guild.id, defaultSettings);
    if (msg.content.indexOf(config.prefix) === 0) {
        await processMessageCommand(conf.prefix, msg);
        return;
    }

    //Process image uploads
    if (msg.channel.id == conf.channel) {
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
            if(!message.author.id != ownerId)
                await message.reply("You're not the owner, sorry!");
            

            // Let's get our key and value from the arguments. 
            // This is array destructuring, by the way. 
            const [prop, ...value] = args;
            // Example: 
            // prop: "prefix"
            // value: ["+"]
            // (yes it's an array, we join it further down!)

            // We can check that the key exists to avoid having multiple useless, 
            // unused keys in the config:
            if(!client.settings.has(message.guild.id, prop))
                await message.reply("This key is not in the configuration.");
            

            // Now we can finally change the value. Here we only have strings for values 
            // so we won't bother trying to make sure it's the right type and such. 
            client.settings.set(message.guild.id, value.join(" "), prop);

            // We can confirm everything's done to the client.
            await message.channel.send(`Guild configuration item ${prop} has been changed to:\n\`${value.join(" ")}\``);
            break;
    }
}

/** Processes a message and try to upload any images found in it */
async function processMessageUpload(msg) {

    //See if it is a gallery post
    let gallery = await findGalleryFromMessageContent(msg.content);
    if (gallery != null) {
        msg.react('🔥');
        return;
    }

    /** Lock the user, we dont want to parse them while they are doing stuff.
     * This is mostly because we get dupe events otherwise.
     */
    if (userLock[msg.author.id]) return;
    userLock[msg.author.id] = true;

    //Processing indicator
    const reaction = await msg.react('🕑');

    //The original message the bot set last time
    // (disabled for now)
    const gallmsg   = null; //await msg.channel.send(proxyImage(url));

    //Find any URL in the sent message
    const regexp = /(https?:\/\/)?([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b)([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)?/ig;
    let matches;
    let links = [];
    while((matches = regexp.exec(msg.content)) !== null) {
        
        //Submit the message and cache the ids so we dont look it up again
        // We rebuild the URL because we want them to paste without the http
        const url       = (matches[1] ?? 'https://') + matches[2] + matches[3];
        links.push(url);
    }

    //Add all the attachments
    let hasAtLeastOneAttachment = false;
    msg.attachments.forEach((key, value) => {
        hasAtLeastOneAttachment = true;
        links.push(key.url);
    });

    //Wait for more attachments
    if (hasAtLeastOneAttachment) {
        try {
            await new Promise((resolve, reject) => {
                let timeout = setTimeout(() => { clearTimeout(timeout); reject(`Exceeded time limit.`); }, 2500);
                let listener = (message) => {
                    if (message.author.id === msg.author.id) {
                        if (message.attachments.size > 0) {
                            message.attachments.forEach((key, value) => { links.push(key.url); });                  //Push the URL
                            setTimeout(() => { clearTimeout(timeout); reject(`Exceeded time limit.`); }, 1000);     //Reset the timeout
                        } else {
                            discord.removeListener(listener);
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
        await reaction.remove();
        return;
    }


    //Publish the image and set the results in the cache so in the future we can look it up faster
    try {
        gallery = await gall.actAs(msg.author.id).publish(links, msg.guild.id, msg.channel.id, msg.id);

        galleryCache.set(msg.id, gallery ? gallery.id : null);
        if (gallmsg != null)
            galleryCache.set(gallmsg.id, gallery ? gallery.id : null);

        //Supress the embed for admins
        msg.suppressEmbeds(true);

        //Send teh resulting message with the post
        if (gallery) await sendGalleryMessage(msg.channel, gallery, gallmsg);
    }catch(error) {
        await msg.react('❌');
        console.error(error);
    } finally {
        await reaction.remove();
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
        let gallery = await findGalleryFromMessageIds(reactionEvent.message_id, reactionEvent.channel_id);
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

/**
 * @param {Discord.TextChannel} channel the discord channel
 * @param {Gallery} gallery the gallery
 */
async function sendGalleryMessage(channel, gallery, editMessage = null) {
    console.log('posting', gallery);
    const img = proxyImage(gallery.cover.origin);

    //const content = `**GALL Post**\n${process.env.GALL_URL}gallery/${gallery.id}/\n${img}`;
    const content = `${process.env.GALL_URL}gallery/${gallery.id}/`;
        
    let message = null;
    if (editMessage) {
        message = editMessage;
        await editMessage.edit(content);
    } else {
        message = await channel.send(content);
    }
    message.react('🔥');
    return message;
}

function proxyImage(url) {
    return process.env.GALL_URL + "api/proxy?url=" + encodeURIComponent(url);
}

/** Finds a gallery from the given message and channel ids */
async function findGalleryFromMessageIds(message_id, channel_id) {
    if (!galleryCache.has(message_id)) {
        let gallery = null;

        //Search for the galleries
        const galleries = await gall.findGalleries(message_id);
        if (galleries.length > 0) {
            gallery = galleries[0];
        } else {
            
            //Lets see if it has an appropriate regex
            const channel = await discord.channels.fetch(channel_id);
            if (channel) {
                const message = await channel.messages.fetch(message_id);
                if (message && message.content) {
                    gallery = await findGalleryFromMessageContent(message.content);
                }
            }
        }

        //Set the cache
        galleryCache.set(message_id, gallery);
    }
    
    //Finally return the cached value
    return galleryCache.get(message_id);
}

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