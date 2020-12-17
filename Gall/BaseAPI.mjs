import fetch from 'node-fetch';
import { User, Gallery } from './Types.mjs';

export class BaseAPI {

    #authorization = null;
    #actingAs = null;

    constructor(baseUrl, authorization = null) {
        this.baseUrl = baseUrl;
        this.#authorization = authorization;
    }

    /** Sets who we are going to act as.
     * @return {BaseAPI} ourselves so we can daisy chain it
     */
    actAs(snowflake) {
        this.#actingAs = snowflake;
        return this;
    }

    /** Gets the currently identified user information. */
    async me() {
        const payload = await this.fetch('GET', `/@me`);
        return {
            user:   new User(this, payload.user),
            acting: payload.acting ? new User(this, payload.acting) : null
        }
    }

    /** Publishes a URL */
    async publish(url, guild_id = null, channel_id = null, message_id = null) {
        console.log('publishing gallery');
        const result = await this.fetch('POST', `/gallery`, { 
            url:        url,
            guild_id:   guild_id,
            channel_id: channel_id,
            message_id: message_id,
        });

        if (typeof result[url] === 'string') {
            console.error('Publish Failure:', result[url]);
            return false;
        }
        
        return new Gallery(this, result[Object.keys(result)[0]]);
    }
    async findGalleries(query) {
        const results = await this.fetch('GET', '/gallery?q=' + encodeURIComponent(query));
        return results.map(data => new Gallery(this, data));
    }
    async getGallery(id) {
        const results = await this.fetch('GET', `/gallery/${id}`);
        return new Gallery(this, results);
    }

    //Reactions
    /** Adds a reaction for the current user. */
    async addReaction(gallery, emoji) {
        const gallery_id = gallery.id || gallery;
        const emoji_id          = emoji.id ?? emoji;
        const emoji_name        = emoji.name ?? null;
        const emoji_animated    = emoji.animated ?? false;
        return await this.fetch('POST', `/gallery/${gallery_id}/reactions`, { 
            id:         emoji_id,
            name:       emoji_name,
            animated:   emoji_animated
        });
    }
    /** Removes a reaction for the current user */
    async removeReaction(gallery, emoji) {
        const gallery_id = gallery.id || gallery;
        const emoji_id      = emoji.id ?? emoji;
        const emoji_name    = emoji.name ?? null; // We pass the name because some emojis (🔥) send them as a name not ID.
        return await this.fetch('DELETE', `/gallery/${gallery_id}/reactions?id=${emoji_id}&name=${emoji_name}`);
    }

    /** Publishes a guild to the server */
    async addGuild(id) {
        console.log('Registering guild with GALL', id);
        return await this.fetch('POST', '/guild', { guild_id: id });
    }
    /** Removes a guild from the server */
    async removeGuild(id) {
        console.log('Registering guild with GALL', id);
        return await this.fetch('DELETE', `/guild/${id}`);
    }
    /** Updates a guild */
    async updateGuild(id, name, emojis = null) {
        console.log('Updating guild with GALL', id, name, emojis);
        return await this.fetch('PUT', `/guild/${id}`, { name, emojis });
    }

    /** Adds an emoji */
    async createEmoji(emoji) {
        return await this.fetch('POST', `/emotes`, emoji);
    }
    /** Updates an emoji */
    async updateEmoji(emoji) {
        return await this.fetch('PUT', `/emotes/${emoji.id}`, emoji);
    }
    /** Deletes kan emoji */
    async deleteEmoji(emoji) {
        const emote_id = emoji.id || emoji;
        return await this.fetch('DELETE', `/emotes/${emote_id}`);
    }

    /** Gallery stuff that will be mvoed back */
    
    async pin(gallery = null) {
        if (typeof kiss !== 'undefined' && gallery == null) gallery = kiss.PARAMS.gallery_id;
        if (gallery == null) throw new Error('Cannot pin gallery without an id. Either pass an ID or visit a gallery page');
        const gallery_id = gallery.id || gallery;
        return await this.fetch('POST', `/gallery/${gallery_id}/pin`);
    }
    async favourite(gallery = null) {
        if (typeof kiss !== 'undefined' && gallery == null) gallery = kiss.PARAMS.gallery_id;
        if (gallery == null) throw new Error('Cannot favourite gallery without an id. Either pass an ID or visit a gallery page');
        const gallery_id = gallery.id || gallery;
        return await this.fetch('POST', `/gallery/${gallery_id}/favourite`);
    }
    async unfavourite(gallery = null) {
        if (typeof kiss !== 'undefined' && gallery == null) gallery = kiss.PARAMS.gallery_id;
        if (gallery == null) throw new Error('Cannot favourite gallery without an id. Either pass an ID or visit a gallery page');
        const gallery_id = gallery.id || gallery;
        return await this.fetch('DELETE', `/gallery/${gallery_id}/favourite`);
    }

    /** Queries the API
     * @param {String} method 
     * @param {String} endpoint 
     */
    async fetch(method, endpoint, data = null) {

        let headers = { 'Content-Type': 'application/json' };
        if (this.#actingAs != null)         headers['X-Actors-Snowflake'] = this.#actingAs;
        if (this.#authorization != null)    headers['Authorization'] = 'Bearer ' + this.#authorization;

        console.log(method, endpoint, data, headers);
        const body = data ? JSON.stringify(data) : null;
        let response = await fetch(`${this.baseUrl}${endpoint}`, { 
            method: method,
            headers: headers,
            body: body
        });

        if (!response.ok) {
            console.error("Failed ", method, endpoint, response, await response.json());
            switch(response.status) {
                default: return null;
                case 403:
                case 401:
                    throw new Error('Forbidden');

                case 400:
                    throw new Error('Bad Request');
            }
        }
    
        let json = await response.json();
        console.log(method, endpoint, data, body, json);
        return json.data;
    }
}
