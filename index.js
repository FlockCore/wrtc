var dWebStreams2 = require('@dwcore/dws2')
var dWebPeer = require('@dwebs/peer')
var inherits = require('inherits')
var events = require('events')
var cuid = require('cuid')
var once = require('once')
var debug = require('debug')('@flockcore/webrtc')

module.exports = dWebFlockingWebRTC

function dWebFlockingWebRTC (tower, opts) {
  if (!(this instanceof dWebFlockingWebRTC)) return new dWebFlockingWebRTC(tower, opts)
  if (!tower) throw new Error('DWebTower instance required')
  if (!opts) opts = {}

  events.EventEmitter.call(this)
  this.setMaxListeners(0)

  this.tower = tower
  this.wrtc = opts.wrtc
  this.channelConfig = opts.channelConfig
  this.config = opts.config
  this.stream = opts.stream
  this.wrap = opts.wrap || function (data) { return data }
  this.unwrap = opts.unwrap || function (data) { return data }
  this.offerConstraints = opts.offerConstraints || {}
  this.maxPeers = opts.maxPeers || Infinity
  this.me = opts.uuid || cuid()
  debug('my uuid:', this.me)

  this.remotes = {}
  this.peers = []
  this.closed = false

  subscribe(this, tower)
}

inherits(dWebFlockingWebRTC, events.EventEmitter)

dWebFlockingWebRTC.WEBRTC_SUPPORT = dWebPeer.WEBRTC_SUPPORT

dWebFlockingWebRTC.prototype.close = function (cb) {
  if (this.closed) return
  this.closed = true

  if (cb) this.once('close', cb)

  var self = this
  this.tower.close(function () {
    var len = self.peers.length
    if (len > 0) {
      var closed = 0
      self.peers.forEach(function (peer) {
        peer.once('close', function () {
          if (++closed === len) {
            self.emit('close')
          }
        })
        process.nextTick(function () {
          peer.destroy()
        })
      })
    } else {
      self.emit('close')
    }
  })
}

function setup (flock, peer, id) {
  peer.on('connect', function () {
    debug('connected to peer', id)
    flock.peers.push(peer)
    flock.emit('peer', peer, id)
    flock.emit('connect', peer, id)
  })

  var onclose = once(function (err) {
    debug('disconnected from peer', id, err)
    if (flock.remotes[id] === peer) delete flock.remotes[id]
    var i = flock.peers.indexOf(peer)
    if (i > -1) flock.peers.splice(i, 1)
    flock.emit('disconnect', peer, id)
  })

  var beams = []
  var sending = false

  function kick () {
    if (flock.closed || sending || !beams.length) return
    sending = true
    var data = {from: flock.me, beam: beams.shift()}
    data = flock.wrap(data, id)
    flock.tower.broadcast(id, data, function () {
      sending = false
      kick()
    })
  }

  peer.on('beam', function (sig) {
    beams.push(sig)
    kick()
  })

  peer.on('error', onclose)
  peer.once('close', onclose)
}

function subscribe (flock, tower) {
  tower.subscribe('all').pipe(dWebStreams2.obj(function (data, enc, cb) {
    data = flock.unwrap(data, 'all')
    if (flock.closed || !data) return cb()

    debug('/all', data)
    if (data.from === flock.me) {
      debug('skipping self', data.from)
      return cb()
    }

    if (data.type === 'connect') {
      if (flock.peers.length >= flock.maxPeers) {
        debug('skipping because maxPeers is met', data.from)
        return cb()
      }
      if (flock.remotes[data.from]) {
        debug('skipping existing remote', data.from)
        return cb()
      }

      debug('connecting to new peer (as initiator)', data.from)
      var peer = new dWebPeer({
        wrtc: flock.wrtc,
        initiator: true,
        channelConfig: flock.channelConfig,
        config: flock.config,
        stream: flock.stream,
        offerConstraints: flock.offerConstraints
      })

      setup(flock, peer, data.from)
      flock.remotes[data.from] = peer
    }

    cb()
  }))

  tower.subscribe(flock.me).once('open', connect.bind(null, flock, tower)).pipe(dWebStreams2.obj(function (data, enc, cb) {
    data = flock.unwrap(data, flock.me)
    if (flock.closed || !data) return cb()

    var peer = flock.remotes[data.from]
    if (!peer) {
      if (!data.beam || data.beam.type !== 'offer') {
        debug('skipping non-offer', data)
        return cb()
      }

      debug('connecting to new peer (as not initiator)', data.from)
      peer = flock.remotes[data.from] = new dWebPeer({
        wrtc: flock.wrtc,
        channelConfig: flock.channelConfig,
        config: flock.config,
        stream: flock.stream,
        offerConstraints: flock.offerConstraints
      })

      setup(flock, peer, data.from)
    }

    debug('beaming', data.from, data.beam)
    peer.beam(data.beam)
    cb()
  }))
}

function connect (flock, tower) {
  if (flock.closed || flock.peers.length >= flock.maxPeers) return
  var data = {type: 'connect', from: flock.me}
  data = flock.wrap(data, 'all')
  tower.broadcast('all', data, function () {
    setTimeout(connect.bind(null, flock, tower), Math.floor(Math.random() * 2000) + (flock.peers.length ? 13000 : 3000))
  })
}
