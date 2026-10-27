const mongoose = require('mongoose');

const cachedProfileSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    data: {
        type: Object,
        required: true
    },
    fetchedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('CachedProfile', cachedProfileSchema);