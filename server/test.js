const request = require('request');
const fs = require('fs');
const EventSource = require('eventsource')

const server = 'https://port-8080-battletank-io-lee508578.codeanyapp.com/api'

// Create user
request.post(`${server}/user`, { json: true }, (err, res, body) => {
  if(err) console.log(err)

  const userId = body.userId
  console.log("created user", userId)

  // Create app
  request.post(`${server}/user/${userId}/app`, { json: true }, (err, res, body) => {
    if(err) console.log(err)
    const appId = body.appId
    console.log("created app", appId)

    // Configure app
    request.put({
      headers: {'Content-Type' : 'application/octet-stream'},
      url: `${server}/user/${userId}/app/${appId}/source`,
      body: fs.readFileSync("./firstbot.js")
    }, (err, res, body) => {
      if(err) console.log(err)
      console.log(body)
      console.log("set app source", appId)
    });

    // Put app into arena
    request.put(`${server}/user/${userId}/arena/app/${appId}`, { json: true }, (err, res, body) => {
      if(err) console.log(err)
      console.log("put app in arena", userId, appId)
    })
  })

  // Create app
  request.post(`${server}/user/${userId}/app`, { json: true }, (err, res, body) => {
    if(err) console.log(err)
    const appId = body.appId
    console.log("created app", appId)

    // Configure app
    request.put({
      headers: {'Content-Type' : 'application/octet-stream'},
      url: `${server}/user/${userId}/app/${appId}/source`,
      body: fs.readFileSync("./firstbot.js")
    }, (err, res, body) => {
      if(err) console.log(err)
      console.log("set app source", appId)
    });

    // Put app into arena
    request.put(`${server}/user/${userId}/arena/app/${appId}`, { json: true }, (err, res, body) => {
      if(err) console.log(err)
      console.log("put app in arena", userId, appId)

        // Create and stream events from battle
/*
        console.log("battle")
        var source = new EventSource(`${server}/user/${userId}/arena/events`);
        source.onmessage = function(message) {
          console.log(message.data)
        };
        request.post(`${server}/user/${userId}/arena/reset`, { json: true }, (err, res, body) => {
          if(err) console.log(err)
          console.log("reset arena", userId)
        })
*/
      })
    })
  });
