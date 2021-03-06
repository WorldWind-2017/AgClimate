/*
 * Copyright (C) 2014 United States Government as represented by the Administrator of the
 * National Aeronautics and Space Administration. All Rights Reserved.
 */
/**
 * @exports MemoryCache
 * @version $Id: MemoryCache.js 2911 2015-03-19 18:36:01Z tgaskins $
 */
define([
        '../error/ArgumentError',
        '../util/Logger'
    ],
    function (ArgumentError,
              Logger) {
        "use strict";

        /**
         * Constructs a memory cache of a specified size.
         * @alias MemoryCache
         * @constructor
         * @classdesc Provides a limited-size memory cache of key-value pairs. The meaning of size depends on usage.
         * Some instances of this class work in bytes while others work in counts. See the documentation for the
         * specific use to determine the size units.
         * @param {Number} capacity The cache's capacity.
         * @param {Number} lowWater The size to clear the cache to when its capacity is exceeded.
         * @throws {ArgumentError} If either the capacity is 0 or negative or the low-water value is greater than
         * or equal to the capacity or less than 1.
         */
        var MemoryCache = function (capacity, lowWater) {
            if (!capacity || capacity < 1) {
                throw new ArgumentError(Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "constructor",
                    "The specified capacity is undefined, zero or negative"));
            }

            if (!lowWater || lowWater >= capacity || lowWater < 0) {
                throw new ArgumentError(Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "constructor",
                    "The specified low-water value is undefined, greater than or equal to the capacity, or less than 1"));
            }

            // Documented with its property accessor below.
            this._capacity = capacity;

            // Documented with its property accessor below.
            this._lowWater = lowWater;

            /**
             * The size currently used by this cache.
             * @type {Number}
             * @readonly
             */
            this.usedCapacity = 0;

            /**
             * The size currently unused by this cache.
             * @type {Number}
             * @readonly
             */
            this.freeCapacity = capacity;

            // Private. The cache entries.
            this.entries = {};

            // Private. The cache listeners.
            this.listeners = [];
        };

        Object.defineProperties(MemoryCache.prototype, {
            /**
             * The maximum this cache may hold. When the capacity is explicitly set via this property, and the current
             * low-water value is greater than the specified capacity, the low-water value is adjusted to be 85% of
             * the specified capacity. The specified capacity may not be less than or equal to 0.
             * @type {Number}
             * @memberof MemoryCache.prototype
             */
            capacity: {
                get: function() {
                    return this._capacity;
                },
                set: function (value) {
                    if (!value || value < 1) {
                        throw new ArgumentError(
                            Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "capacity",
                                "Specified cache capacity is undefined, 0 or negative."));
                    }

                    var oldCapacity = this._capacity;

                    this._capacity = value;

                    if (this._capacity <= this.lowWater) {
                        this._lowWater = 0.85 * this._capacity;
                    }

                    // Trim the cache to the low-water mark if it's less than the old capacity
                    if (this._capacity < oldCapacity) {
                        this.makeSpace(0);
                    }
                }
            },

            /**
             * The size to clear this cache to when its capacity is exceeded. It must be less than the current
             * capacity and not negative.
             * @type {Number}
             * @memberof MemoryCache.prototype
             */
            lowWater: {
                get: function () {
                    return this._lowWater;
                },
                set: function (value) {
                    if (!value || value >= this._capacity || value < 0) {
                        throw new ArgumentError(
                            Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "lowWater",
                                "Specified cache low-water value is undefined, negative or not less than the current capacity."));
                    }

                    this._lowWater = value;
                }
            }
        });

        /**
         * Returns the entry for a specified key.
         * @param {String} key The key of the entry to return.
         * @returns {Object} The entry associated with the specified key, or null if the key is not in the cache or
         * is null or undefined.
         */
        MemoryCache.prototype.entryForKey = function (key) {
            if (!key)
                return null;

            var cacheEntry = this.entries[key];
            if (!cacheEntry)
                return null;

            cacheEntry.lastUsed = Date.now();

            return cacheEntry.entry;
        };

        /**
         * Adds a specified entry to this cache.
         * @param {String} key The entry's key.
         * @param {Object} entry The entry.
         * @param {Number} size The entry's size.
         * @throws {ArgumentError} If the specified key or entry is null or undefined or the specified size is less
         * than 1.
         */
        MemoryCache.prototype.putEntry = function (key, entry, size) {
            if (!key) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "putEntry", "missingKey."));
            }

            if (!entry) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "putEntry", "missingEntry."));
            }

            if (size < 1) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "putEntry",
                        "The specified entry size is less than 1."));
            }

            var existing = this.entries[key],
                cacheEntry;

            if (existing) {
                this.removeEntry(key);
            }

            if (this.usedCapacity + size > this._capacity) {
                this.makeSpace(size);
            }

            this.usedCapacity += size;
            this.freeCapacity = this._capacity - this.usedCapacity;

            cacheEntry = {
                key: key,
                entry: entry,
                size: size,
                lastUsed: Date.now()
            };

            this.entries[key] = cacheEntry;
        };

        /**
         * Removes all resources from this cache.
         * @param {Boolean} callListeners If true, the current cache listeners are called for each entry removed.
         * If false, the cache listeners are not called.
         */
        MemoryCache.prototype.clear = function (callListeners) {
            if (callListeners) {
                // Remove each entry individually so that the listeners can be called for each entry.
                for (var key in this.entries) {
                    if (this.entries.hasOwnProperty(key)) {
                        this.removeCacheEntry(key);
                    }
                }
            }

            this.entries = {};
            this.freeCapacity = this._capacity;
            this.usedCapacity = 0;
        };

        /**
         * Remove an entry from this cache.
         * @param {String} key The key of the entry to remove. If null or undefined, this cache is not modified.
         */
        MemoryCache.prototype.removeEntry = function (key) {
            if (!key)
                return;

            var cacheEntry = this.entries[key];
            if (cacheEntry) {
                this.removeCacheEntry(cacheEntry);
            }
        };

        // Private. Removes a specified entry from this cache.
        MemoryCache.prototype.removeCacheEntry = function (cacheEntry) {
            // All removal passes through this function.

            delete this.entries[cacheEntry.key];

            this.usedCapacity -= cacheEntry.size;
            this.freeCapacity = this._capacity - this.usedCapacity;

            for (var i = 0, len = this.listeners.length; i < len; i++) {
                try {
                    this.listeners[i].entryRemoved(cacheEntry.key, cacheEntry.entry);
                } catch (e) {
                    this.listeners[i].removalError(e, cacheEntry.key, cacheEntry.entry);
                }
            }
        };

        /**
         * Indicates whether a specified entry is in this cache.
         * @param {String} key The key of the entry to search for.
         * @returns {Boolean} true if the entry exists, otherwise false.
         */
        MemoryCache.prototype.containsKey = function (key) {
            return key && this.entries[key];
        };

        /**
         * Adds a cache listener to this cache.
         * @param {MemoryCacheListener} listener The listener to add.
         * @throws {ArgumentError} If the specified listener is null or undefined or does not implement both the
         * entryRemoved and removalError functions.
         */
        MemoryCache.prototype.addCacheListener = function (listener) {
            if (!listener) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "addCacheListener", "missingListener"));
            }

            if (typeof listener.entryRemoved != "function" || typeof listener.removalError != "function") {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "addCacheListener",
                        "The specified listener does not implement the required functions."));
            }

            this.listeners.push(listener);
        };

        /**
         * Removes a cache listener from this cache.
         * @param {MemoryCacheListener} listener The listener to remove.
         * @throws {ArgumentError} If the specified listener is null or undefined.
         */
        MemoryCache.prototype.removeCacheListener = function (listener) {
            if (!listener) {
                throw new ArgumentError(
                    Logger.logMessage(Logger.LEVEL_SEVERE, "MemoryCache", "removeCacheListener", "missingListener"));
            }

            var index = this.listeners.indexOf(listener);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };

        // Private. Clears this cache to that necessary to contain a specified amount of free space.
        MemoryCache.prototype.makeSpace = function (spaceRequired) {
            var sortedEntries = [];

            // Sort the entries from least recently used to most recently used, then remove the least recently used entries
            // until the cache capacity reaches the low water and the cache has enough free capacity for the required
            // space.

            var sizeAtStart = this.usedCapacity;
            for (var key in this.entries) {
                if (this.entries.hasOwnProperty(key)) {
                    sortedEntries.push(this.entries[key]);
                }
            }

            sortedEntries.sort(function (a, b) {
                return a.lastUsed - b.lastUsed;
            });

            for (var i = 0, len = sortedEntries.length; i < len; i++) {
                if (this.usedCapacity > this._lowWater || this.freeCapacity < spaceRequired) {
                    this.removeCacheEntry(sortedEntries[i]);
                } else {
                    break;
                }
            }
        };

        return MemoryCache;
    });