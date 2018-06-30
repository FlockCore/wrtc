var server = require('@dwebs/tower/server')()
var beamhub = require('@dwebs/tower')
var flock = require('./')
var test = require('tape')
var wrtc = require('electron-webrtc')()

test.onFinish(function () {
  server.close()
  wrtc.close()
})

server.listen(9000, function () {
  test('greet and close', function (t) {
    t.plan(8)

    var hub1 = beamhub('app', 'localhost:9000')
    var hub2 = beamhub('app', 'localhost:9000')

    var sw1 = flock(hub1, {wrtc})
    var sw2 = flock(hub2, {wrtc})

    var greetings = 'greetings'
    var adios = 'adios'

    var peerIds = {}

    sw1.on('peer', function (peer, id) {
      t.pass('connected to peer from sw2')
      peerIds.sw2 = id
      peer.send(greetings)
      peer.on('data', function (data) {
        t.equal(data.toString(), adios, 'adios received')
        sw1.close(function () {
          t.pass('flock sw1 closed')
        })
      })
    })

    sw2.on('peer', function (peer, id) {
      t.pass('connected to peer from sw1')
      peerIds.sw1 = id
      peer.on('data', function (data) {
        t.equal(data.toString(), greetings, 'greetings received')
        peer.send(adios)
        sw2.close(function () {
          t.pass('flock sw2 closed')
        })
      })
    })

    sw1.on('disconnect', function (peer, id) {
      if (id === peerIds.sw2) {
        t.pass('connection to peer from sw2 lost')
      }
    })

    sw2.on('disconnect', function (peer, id) {
      if (id === peerIds.sw1) {
        t.pass('connection to peer from sw1 lost')
      }
    })
  })
})
