import { BaseAPI} from './BaseAPI.mjs';
export class APIObject {
    
    /** @type {BaseAPI} */
    #api;

    /** @return {BaseAPI} the base API */
    get api() { return this.#api; }

    /** @param {BaseAPI} api the base api*/
    constructor(api) {
        this.#api = api;
    }

}

export class User extends APIObject{

    uuid;
    snowflake;
    username;
    displayName;
    profileName;
    profileImage;

    constructor(api, data) {
        super(api);
        this.uuid = data.uuid;
        this.snowflake = data.snowflake;
        this.username = data.username;
        this.displayName = data.displayName;
        this.profileName = data.profileName;
        this.profileImage = data.profileImage ? new Image(api, data.profileImage) : null;
    }

}

export class Gallery extends APIObject{

    id;
    identifier;
    type;
    founder;
    title;
    description;
    url;
    cover;
    views;
    isNew;

    constructor(api, data) {
        super(api);
        this.id             = data.id;
        this.identifier     = data.identifier;
        this.type           = data.type;
        this.founder        = data.founder ? new User(api, data.founder) : null;
        this.title          = data.title;
        this.description    = data.description;
        this.url            = data.url;
        this.cover          = data.cover ? new Image(api, data.cover) : null;
        this.views          = data.views !== null ? data.views : 0;
        this.isNew          = data.views === null;
    }

}

export class Image extends APIObject{

    id;
    url;
    origin;
    isCover;

    constructor(api, data) {
        super(api);
        this.id = data.id;
        this.url = data.url;
        this.origin = data.origin;
        this.isCover = data.is_cover;
    }

}