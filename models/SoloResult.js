const mongoose = require('mongoose');
const SoloResultSchema = new mongoose.Schema({
  username: { type: String, required: true },
  wpm: { type: Number, required: true },
  accuracy: { type: Number, required: true },
  errorCount: { type: Number, required: true },   
  timeElapsed: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }

});

module.exports = mongoose.model('SoloResult', SoloResultSchema);
