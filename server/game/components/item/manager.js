import Promise from 'bluebird';

// manager specific imports
import ItemModel from './model';
import ItemList from '../../data/items.json';
import Item from './object';
import ItemCommands from './commands';
import {ucfirst} from '../../helper';

/**
 * Item Manager
 */
export default class ItemManager {
    /**
     * Class constructor
     * @param  {Game} Game The main Game object
     */
    constructor(Game) {
        this.Game = Game;
        // list of all items in the game, for reference
        this.templates = {};
        // dropped items, references items from the items list
        this.dropped_items = {};
    }

    /**
     * Load item templates
     * @return {Promise}
     */
    init() {
        ItemList.map((itemData) => {
            this.templates[itemData.id] = new Item(null, itemData);
        });

        // register the commands
        this.Game.commandManager.registerManager(ItemCommands);

        // set the initial item prices.
        this.updatePrices();
        console.log('ITEM MANAGER LOADED');
    }

    /**
     * Get a list of items at the grid location
     * @param  {String} map        Map Id
     * @param  {Number} x
     * @param  {Number} y
     * @param  {Boolean} toClient  If true, will return a new object with minimal info (for clients)
     * @return {Array}     Array of items
     */
    getLocationList(map_id, x, y, toClient = false) {
        const location = this.dropped_items[`${map_id}_${y}_${x}`];

        if (!location) {
            return [];
        }

        if (!toClient) {
            return location;
        }

        return location.map((item) => {
            return {
                id: item.id,
                ...item.getModifiers(),
            };
        });
    }

    /**
     * Adds an item to the ground at the given location.
     * @param  {String}      map_id     Map ID
     * @param  {Number}      x          East
     * @param  {Number}      y          North
     * @param  {Item Object} itemObject The item reference
     * @return {Array}                  List of items at the given location
     */
    drop(map_id, x, y, itemObject) {
        const gridId = `${map_id}_${y}_${x}`;
        this.Game.logger.debug('ItemManager::drop', {map_id, x, y, id: itemObject.id});

        // Generate the item location, should it not exist.
        this.dropped_items[gridId] = this.dropped_items[gridId] || [];

        // stack items if possible
        let itemIndex = -1;

        // remove any database ID's from the item, should there be any (since its not longer owned by a player)
        itemObject._id = null;

        if (itemObject.stats.stackable) {
            itemIndex = this.dropped_items[gridId].findIndex((item) => item.id === itemObject.id);

            if (itemIndex !== -1) {
                this.dropped_items[gridId][itemIndex].addDurability(itemObject.stats.durability);
            }
        } else {
            // reset their dropped status, in case its due to dying the items are dropped.
            itemObject.inventorySlot = null;
        }

        // add item to the dropped items array, if the item was not stacked or if its
        // a non-stackable item
        if (itemIndex === -1) {
            this.dropped_items[gridId].push(itemObject);
        }

        return this.dropped_items[gridId];
    }

    /**
     * Remove an item (or an amount of an item) on the ground, at the specified location
     * @param  {String} map_id   Map ID
     * @param  {Number} x        East
     * @param  {Number} y        North
     * @param  {String} itemName Item to search for
     * @param  {Number} amount   Stackable items only
     * @return {Item Obj}        Item object which was remove.
     */
    pickup(map_id, x, y, itemName, amount) {
        // get the list of items at the location
        const locationItems = this.getLocationList(map_id, x, y);
        let foundItemIndex = -1;
        let foundItem;

        if (!locationItems.length) {
            return 'No items at the location';
        }

        // find the item at the location, the user wants to pickup
        if (itemName) {
            itemName = itemName.toLowerCase();

            // check if there is a direct match for the item name
            foundItemIndex = locationItems.findIndex((obj) => obj.name.toLowerCase() === itemName);

            if (foundItemIndex === -1) {
                // otherwise check if there is an item beginning with the name
                foundItemIndex = locationItems.findIndex((obj) => obj.name.toLowerCase().indexOf(itemName) !== -1);
            }

            // if still not found, reject
            if (foundItemIndex === -1) {
                return 'Item not found';
            }

            foundItem = locationItems[foundItemIndex];
        } else {
            foundItemIndex = 0;
            foundItem = locationItems[foundItemIndex];
        }

        // If the item is a non-stackable item, we remove it and return it.
        if (!foundItem.stats.stackable) {
            return locationItems.splice(foundItemIndex, 1)[0];
        }

        // if the amount of less or equal to what we need, just return the whole item
        if (foundItem.stats.durability <= amount) {
            return locationItems.splice(foundItemIndex, 1)[0];
        }

        // reduce durability of the item on the ground
        foundItem.stats.durability = foundItem.stats.durability - amount;
        // return a new items, with the durability we need
        return this.add(foundItem.id, {durability: amount});
    }

    /**
     * Generates and adds the item to the managed get
     * @param {String} itemId     Item ID
     * @param {Object} modifiers  The list of stats overwrites to the template, for the item.
     * @param {String} dbId       Database _id of the item, used for saving the item later.
     */
    add(itemId, modifiers = {}, dbId = null) {
        //this.Game.logger.debug('ItemManager::add', {itemId})
        const template = this.getTemplate(itemId);

        if (!template) {
            return null;
        }

        const itemData = {...template};
        // nested objects are still copied as reference, so we have to make a "sub-copy" of the stats.
        itemData.stats = {...template.stats};

        const NewItem = new Item(this.Game, itemData, modifiers);
        // set the database ID
        NewItem._id = dbId;

        return NewItem;
    }

    /**
     * Removes an item from the game (and db)
     * @param  {Character} character item to remove
     * @param  {Item Obj}  item      item to remove
     * @return {Promise}
     */
    async remove(character, item) {
        const itemClone = {...item};
        item.destroy();

        character.inventory.forEach((obj, index) => {
            if (obj.remove) {
                character.inventory.splice(index, 1);
            }
        });

        // if the item is in the DB, delete it.
        if (itemClone._id) {
            try {
                const dbItem = await this.dbLoad(itemClone);
                dbItem.remove();
            } catch (err) {
                this.Game.onError(err);
            }
        }
    }

    /**
     * Get the list of all item templates, to return to the client
     * @return {Object} Plain object of all item templates
     */
    getTemplates() {
        const list = {};

        Object.keys(this.templates).map((itemId) => {
            list[itemId] = this.templates[itemId].toObject();
        });

        return list;
    }

    /**
     * Retrives an item template, from an item id
     * @param  {String} item_id Item ID
     * @return {Object}         Plain object of the item template
     */
    getTemplate(item_id) {
        return this.templates[item_id.toLowerCase()];
    }

    /**
     * Retrives an item template, from an item name
     * @param  {String} itemName Item ID
     * @return {Object}         Plain object of the item template
     */
    getTemplateByName(itemName) {
        itemName = itemName.toLowerCase();

        // first check if there is a direct match between the name and a player
        for (let itemId in this.templates) {
            if (this.templates[itemId].name.toLowerCase() === itemName) {
                return this.templates[itemId];
            }
        }

        // otherwise see if there are any items which begins with the string
        for (let itemId in this.templates) {
            if (this.templates[itemId].name.toLowerCase().indexOf(itemName) === 0) {
                return this.templates[itemId];
            }
        }

        return null;
    }

    /**
     * Load an NPC's inventory
     * @param  {NPN} NPC The NPC object whos inventory to load
     * @return {Promise}
     */
    loadNPCInventory(NPC) {
        // If the npc does not have any inventory, just ignore this
        if (!NPC.inventory || !NPC.inventory.length) {
            return [];
        }

        const inventory = NPC.inventory.map((item) => {
            let newItem = this.add(item.item_id, item.modifiers, null);
            newItem.inventorySlot = item.inventorySlot;

            return newItem;
        });

        return inventory;
    }

    /**
     * Load Character inventory
     * @param  {Character} character The player character
     * @return {Promise}
     */
    async loadCharacterInventory(character) {
        const items = await ItemModel.findAsync({character_id: character._id.toString()}, {_id: 1, item_id: 1, modifiers: 1, inventorySlot: 1});

        return items.map((item) => {
            let newItem = this.add(item.item_id, item.modifiers, item._id);
            newItem.inventorySlot = item.inventorySlot;

            return newItem;
        });
    }

    /**
     * Saves a characters inventory
     * @param  {Character Obj} character Character whos inventory we want to save
     * @return {Promise}
     */
    async saveInventory(character) {
        // if the character has no items, resolve right away
        if (character.inventory.length) {
            await Promise.all(character.inventory.map(async (item) => {
                try {
                    return await this.dbSave(character._id, item);
                } catch (err) {
                    this.Game.onError(err);
                }
            }));
        }

        try {
            await this.cleanupDbInventory(character);
        } catch (err) {
            this.Game.onError(err);
        }
    }

    /**
     * Delete items no longer owned by a character from the database
     * @param  {Character} character The player to cleanup
     */
    cleanupDbInventory(character) {
        const itemDbIds = [];

        character.inventory.forEach((obj) => {
            if (obj._id) {
                return itemDbIds.push(obj._id.toString());
            }
        });

        return ItemModel.deleteManyAsync({character_id: character._id.toString(), _id: {$nin: itemDbIds}});
    }

    /**
     * Saves the item in the databse
     * @param  {String} character_id the charcter id of the owner
     * @param  {Item Object} item the Item object to save
     * @return {Mongoose Object}      The mongoose object of the newly saved item
     */
    async dbCreate(character_id, item) {
        // create a new item model
        const newItem = new ItemModel({
            character_id,
            item_id: item.id,
            modifiers: item.getModifiers(),
            inventorySlot: item.inventorySlot,
        });

        await newItem.saveAsync();
        // set the item's _id to the new DB entry.
        item._id = newItem._id;

        return newItem;
    }

    /**
     * Saves an Item Object in the DB, creates a new entry if no existing is found for the item.
     * @param  {String} character_id  Character ID of the item owner
     * @param  {Item Object} item
     * @return {[type]}         [description]
     */
    async dbSave(character_id, item) {
        if (!character_id) {
            return reject(new Error('Missing character_id'));
        }

        // retrive item from database if it has a "_id", so we can update it.
        const loadedItem = await this.dbLoad(item);

        if (!loadedItem) {
            return await this.dbCreate(character_id, item);
        }

        loadedItem.modifiers = item.getModifiers();
        loadedItem.inventorySlot = item.inventorySlot;

        await loadedItem.saveAsync();
        return loadedItem;
    }

    /**
     * Loads an item from the DB, by item DB _id.
     * @param  {String} item_db_id The _id mongo has assigned to the item
     * @return {Object}
     */
    async dbLoad(item) {
        if (!item._id) {
            return null;
        }

        const dbItem = await ItemModel.findOneAsync({_id: item._id.toString()});

        if (!dbItem) {
            throw new Error('Item not found');
        }

        return dbItem;
    }

    /**
     * Updates the prices for items.
     * @return {Promise}
     */
    updatePrices() {
        // loop the templates, and set the new prices for any applicable items
        // update the pricing on items, with the priceRange array defined.
        // We update the templates as they will be used for the sell and buy prices
        Object.keys(this.templates).forEach((itemId) => {
            this.templates[itemId].shufflePrice();
        });
    }

    /**
     * Will get the price of the item
     * @param  {String} itemId The item ID to get the price of
     * @return {Promise}
     */
    getItemPrice(itemId) {
        const template = this.getTemplate(itemId);

        if (!template) {
            return null;
        }

        return template.stats.price;
    }

    /**
     * Generates helper output for an item
     * @param  {Mixed}  item  Command Object or string. if string, it will search for the commands
     * @return {Mixed}        Message array if found, null otherwise.
     */
    getInfo(item) {
        if (typeof item === 'string') {
            item = this.getTemplateByName(item);
            // if the command does not exist
            if (!item) {
                return null;
            }
        }

        const tab = '    ';
        let message = [
            'Item:',
            `${tab}${item.name}`,
            `${tab}${item.description}`,
            'Type:',
            `${tab}${ucfirst(item.type)}${(item.subtype ? ` (${ucfirst(item.subtype)})` : '')}`,
            'Stats:',
            `${tab}Equipable: ${item.stats.equipable ? 'Yes' : 'No'}`,
            `${tab}Stackable: ${item.stats.stackable ? 'Yes' : 'No'}`,
        ];

        switch (item.subtype) {
            case 'ranged':
            case 'melee':
                message.push(`${tab}Damage: ${item.stats.damage_min}-${item.stats.damage_max}`);
                break;

            case 'ammo':
                message.push(`${tab}Damage Bonus: ${item.stats.damage_bonus}`);
                break;

            case 'body':
                message.push(`${tab}Damage Reduction: ${item.stats.damage_reduction}`);
                message.push(`${tab}Durability: ${item.stats.durability} total damage absorbed.`);
                break;

            default:
                message.push(`${tab}Has Use Effect: ${item.stats.useEffect ? 'Yes' : 'No'}`);
                break;
        }

        return message;
    }
}
