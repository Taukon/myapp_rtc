'use strict';

// --- ES modules ---
import nutjs from "@nut-tree/nut-js";
const { mouse, Point, Button, keyboard, Key, screen} = nutjs;
import https from 'httpolyglot';
import fs from 'fs';
import express from 'express';
import mediasoup from 'mediasoup';
import { networkInterfaces } from "os";
import { exec } from "child_process";
//
// --- commonJS ---
/*
const { mouse, Point, Button, keyboard, Key } = require("@nut-tree/nut-js");
const https = require('httpolyglot');
const fs = require('fs');
const express = require('express');
const mediasoup = require('mediasoup');
const { networkInterfaces } = require("os");
const { exec } = require("child_process");
*/
//

/**
 * Worker
 * |-> Router
 *     |-> WebRtcTransport(s) for Producer
 *         |-> Producer
 *     |-> WebRtcTransport(s) for Consumer
 *         |-> Consumer
 *     |-> DirectTransport for Producer
 *         |-> Producer
 *     |-> DirectTransport(s) for Consumer
 *         |-> Consumer
 **/

const MinPort = 2000;   // --- RtcMinPort
const MaxPort = 2010;   // --- RtcMaxport

const port = 3000;  // --- https Port

let producerList = {};  // --- key: Producer-WebRtcTransport.id, value: transport
let consumerList = {};  // --- key: Consumer-WebRtcTransport.id, value: transport

let directConsumerList = {};    // --- key: Consumer-DirectTransport.id, value: transport

let plainProducerTransport;     // --- Producer-plainTransport

let sockTransportIdList = {};  // --- key: Websocket Id, value: {"producerId": transport.id, "consumerId": transport.id, "directConsumerId": transport.id}
let ffmpegPS;   // ---ffmpeg process
let sockIdList = []; // --- Websocket Id

const limitClient = 2;

// --- for ffmpeg
const display = 1;
let displayWidth;
let displayHeight;
const framerate = 10;
// --- end ffmpeg

// --- HTTPS Server ---
const app = express();

app.use(express.static('public'));

// --- SSL cert for HTTPS access ---
const options = {
    key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
}

function getIpAddress() {
    const nets = networkInterfaces();
    const net = nets["eth0"]?.find((v) => v.family == "IPv4");
    return net.address;
}

const ip_addr = getIpAddress(); // --- IP Address

const httpsServer = https.createServer(options, app)
httpsServer.listen(port, () => {
    console.log('listening on port: ' + port);
    console.log('https://' + ip_addr + ':' + port + '/rtc_client2.html');
})

// --- WebSocket Server ---
//const io = require('socket.io')(httpsServer);
import { Server } from 'socket.io';
const io = new Server(httpsServer);

io.on('connection', sock => {

    screen.width().then(width => {
        displayWidth = width;
    });
    screen.height().then(height => {
       displayHeight = height; 
    });

    sockTransportIdList[sock.id] = {};
    sockIdList.push(sock.id);

    if(sockIdList.length == 1){
        createPlainProducer();
    }

    sock.on('getRtpCapabilities', (_, callback) => {
        //console.log("ListTotal: " + Object.keys(producerList).length);
        console.log("Total List: " + Object.keys(sockTransportIdList).length);
        if (Object.keys(sockTransportIdList).length > limitClient) {
            //console.log("sockIdList length: " + sockIdList.length);
            io.to(sockIdList[0]).emit("end");
        }
        sock.emit("canvas", {width: displayWidth, height: displayHeight});

        callback(router.rtpCapabilities);
    });

    // ----- Producer WebRtcTransport-----

    sock.on('createProducerTransport', async (_, callback) => {
        const { transport, params } = await mycreateWebRtcTransport();
        transport.observer.on('close', () => {
            transport.producer.close();
            transport.producer = null;
            delete producerList[transport.id];
            transport = null;
        });
        callback(params);

        producerList[transport.id] = transport;
        sockTransportIdList[sock.id]["producerId"] = transport.id;
    });

    sock.on('connectProducerTransport', async (req, callback) => {
        const transport = producerList[req.transportId];
        await transport.connect({ dtlsParameters: req.dtlsParameters });
        callback({});
    });

    sock.on('produceData', async (req, callback) => {
        const transport = producerList[req.transportId];
        const dataProducer = await transport.produceData(req.produceParameters);
        callback(dataProducer.id);
      
        //console.log("dataProducer.id: " + dataProducer.id);
        transport.producer = dataProducer;

        //directconsume
        createDirectConsumer(dataProducer.id, sock.id);
    });


    // ----- Consumer WebRtcTransport -----

    sock.on('createConsumerTransport', async (_, callback) => {
        const { transport, params } = await mycreateWebRtcTransport();
        transport.observer.on('close', () => {
            transport.consumer.close();
            transport.consumer = null;
            delete consumerList[transport.id];
            transport = null;
        });
        callback(params);

        consumerList[transport.id] = transport;
        sockTransportIdList[sock.id]["consumerId"] = transport.id;
    });

    sock.on('connectConsumerTransport', async (req, callback) => {
        const transport = consumerList[req.transportId];
        await transport.connect({ dtlsParameters: req.dtlsParameters });
        callback({});
    });


    // --- use plainProducerId: plainTransport.producer.id
    sock.on('consume', async (req, callback) => {
        const transport = consumerList[req.transportId];
        const plainProducerId = plainProducerTransport.producer.id;
        
        const consumer = await transport.consume({
            producerId: plainProducerId,
            rtpCapabilities: req.rtpCapabilities,
            paused: true,
        })
        const params = {
            id: consumer.id,
            producerId: plainProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        };

        consumer.on('transportclose', () => {
            console.log('transport close from consumer');
        })
  
        consumer.on('producerclose', () => {
            console.log('producer of consumer closed');
        })
        
        callback(params);

        await consumer.resume();
        transport.consumer = consumer;

        //console.log("consumerList.length: " + Object.keys(consumerList).length);
    });


    sock.on("disconnect", () => {
        console.log("discconect id: " + sock.id);
        //console.log(JSON.stringify(sockTransportIdList[sock.id]));

        const producerId = sockTransportIdList[sock.id]["producerId"];
        const consumerId = sockTransportIdList[sock.id]["consumerId"];
        const directConsumerId = sockTransportIdList[sock.id]["directConsumerId"];

        const directTransport = directConsumerList[directConsumerId];
        console.log("delete directConsumerTransportId: " + directTransport.id);
        directTransport.close();
        delete directConsumerList[directConsumerId];

        const sendTransport = producerList[producerId];
        console.log("delete producerTransportId: " + sendTransport.id);
        sendTransport.close();
        delete producerList[producerId];

        const recvTransport = consumerList[consumerId];
        console.log("delete consumerTransportId: " + recvTransport.id);
        recvTransport.close();
        delete consumerList[consumerId];

        delete sockTransportIdList[sock.id];
        const indexId = sockIdList.indexOf(sock.id);
        sockIdList.splice(indexId, 1);
        console.log("delete sockIdList length: " + sockIdList.length);

        if (sockIdList.length == 0) {
            const plainTransport = plainProducerTransport;
            console.log("delete plainProducerTransportId: " + plainTransport.id);
            plainTransport.close();

            const pid = ffmpegPS.pid;
            process.kill(pid + 1);
            process.kill(pid);
            console.log("delete ffmpeg process Id: " + pid + ", " + (pid+1));
        }
    });
});


// --- MediaSoup Server ---

let worker = null;
let router = null;

const transportOption = {
    listenIps: [
        {
            ip: ip_addr
        },
    ],
    enableSctp: true,
};

const workerOption = {
    rtcMinPort: MinPort,
    rtcMaxPort: MaxPort,
}

const mediaCodecs = [
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      /*parameters: {
        //'x-google-start-bitrate': 1000,
      },*/
    },
  ];


async function startWorker() {
    worker = await mediasoup.createWorker(workerOption);
    router = await worker.createRouter({mediaCodecs,});
}

async function mycreateWebRtcTransport() {
    const transport = await router.createWebRtcTransport(transportOption);
    return {
        transport: transport,
        params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            sctpParameters: transport.sctpParameters,
        }
    };
}


// --- Producer PlainTransport ---
async function createPlainProducer(){
    const transport = await router.createPlainTransport(
        { 
          listenIp : '127.0.0.1',
          rtcpMux  : false,
          comedia  : true
    });

    plainProducerTransport = transport;

    // Read the transport local RTP port.
    const videoRtpPort = transport.tuple.localPort;
    //console.log("videoRtpPort: "+videoRtpPort);

    // Read the transport local RTCP port.
    const videoRtcpPort = transport.rtcpTuple.localPort;
    //console.log("videoRtcpPort: "+videoRtcpPort);

    const videoProducer = await transport.produce(
        {
          kind          : 'video',
          rtpParameters :
          {
            codecs :
            [
              {
                mimeType     : 'video/vp8',
                clockRate    : 90000,
                payloadType  : 102,
                rtcpFeedback : [ ], // FFmpeg does not support NACK nor PLI/FIR.
              }
            ],
            encodings : [ { ssrc: 22222222 } ]
          }
    });
    transport.producer = videoProducer;

    //console.log("plainProducerId: "+plainProducerTransport.producer.id);

    ffmpegPS = exec(
        //"ffmpeg -video_size "+displayWidth+"x"+displayHeight+" -f x11grab -i :"+display+".0 -map 0:v:0 -pix_fmt yuv420p -c:v libvpx -b:v 1000k -deadline realtime -cpu-used 4 -f tee \"[select=v:f=rtp:ssrc=22222222:payload_type=102]rtp://127.0.0.1:"+videoRtpPort+"?rtcpport="+videoRtcpPort+"\""
        "ffmpeg -video_size "+displayWidth+"x"+displayHeight+" -framerate "+framerate+" -f x11grab -i :"+display+".0 -map 0:v:0 -pix_fmt yuv420p -c:v libvpx -b:v 1000k -deadline realtime -cpu-used 5 -f tee \"[select=v:f=rtp:ssrc=22222222:payload_type=102]rtp://127.0.0.1:"+videoRtpPort+"?rtcpport="+videoRtcpPort+"\""
    );
}


// --- Consumer DirectTransport ---
async function createDirectConsumer(dataProducerId, sockId) {
    //console.log("createDirectConsumer");
    const transport = await router.createDirectTransport();
    directConsumerList[transport.id] = transport;
    sockTransportIdList[sockId]["directConsumerId"] = transport.id;

    const dataConsumer = await transport.consumeData({ dataProducerId: dataProducerId });
    transport.consumer = dataConsumer;

    dataConsumer.on("message", msg => {
        const data = JSON.parse(msg.toString("utf-8"));
        //console.log(data);

// ----------- Work nut-js ------------------
        if(data.move != undefined){
            try {
                mymoveMouse(data.move.x, data.move.y);
                //console.log("try: "+data.move.x +" :"+ data.move.y);
            } catch (error) {
                console.error(error);
            }
        }
        else if(data.leftclick != undefined){
            try {
                if (data.leftclick == "down"){
                    mouse.pressButton(Button.LEFT);
                } else if (data.leftclick == "up"){
                    mouse.releaseButton(Button.LEFT);
                }
                //console.log("try leftclick: " + data.leftclick);
            } catch (error) {
                console.error(error);
            }
        }
        else if (data.rightclick != undefined){
            try {
                mymouseClick(Button.RIGHT);
                //console.log("try rightclick: " + data.rightclick);
            } catch (error) {
                console.error(error);
            }
        }
        if (data.wheel != undefined) {
            try {
                if(data.wheel > 0){
                    mouse.scrollDown(data.wheel);
                }else{
                    mouse.scrollUp(-1 * data.wheel);
                }
                //console.log("wheel: "+ data.wheel);
            } catch (error) {
                console.error(error);
            }
        }
        else if(data.key != undefined){
            try {
                if (data.key.symbol != undefined){
                    mykeyType(data.key.key, data.key.updown);
                } else{
                    mykeyToggle(data.key.key, data.key.updown, data.key.mod);
                }
                //console.log("try key: " + JSON.stringify(data.key));

            } catch (error) {
                console.error(error);
            }
        }
// ---------------------------------------------
    });
}

async function mymoveMouse(x, y){
    const target = new Point(x, y);
    await mouse.setPosition(target);
}

async function mymouseClick(button) {
    await mouse.pressButton(button);
    mouse.releaseButton(button);
}

async function mykeyToggle(key, updown, mod){
    if(key != undefined ){
        mod.unshift(key);
    }

    if(updown == "down"){
        await mykeyPress(mod);
    }else if(updown == "up"){
        await mykeyRelease(mod);
    }
}

async function mykeyPress(key) {

    //console.log("down: "+JSON.stringify(key));
    switch (key.length) {
        case 1:
            await keyboard.pressKey(Key[key[0]]);
            break;
        case 2:
            await keyboard.pressKey(Key[key[1]], Key[key[0]]);
            break;
        case 3:
            await keyboard.pressKey(Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
        case 4:
            await keyboard.pressKey(Key[key[3]], Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
    }
}

async function mykeyRelease(key) {

    //console.log("up: " + JSON.stringify(key));
    switch(key.length){
        case 1:
            await keyboard.releaseKey(Key[key[0]]);
            break;
        case 2:
            await keyboard.releaseKey(Key[key[1]], Key[key[0]]);
            break;
        case 3:
            await keyboard.releaseKey(Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
        case 4:
            await keyboard.releaseKey(Key[key[3]], Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
    }
}

async function mykeyType(key, updown){
    if(updown == 'down'){
        await keyboard.type(key);
        console.log('type: ' + key);
    }
}

startWorker();
