'use strict';

// --- ES modules ---
import https from 'httpolyglot';
import fs from 'fs';
import express from 'express';
import mediasoup from 'mediasoup';
import { networkInterfaces } from "os";
import clientIO from 'socket.io-client';
import bindings from 'bindings';
const converter = bindings('converter');
import { exec } from "child_process";

exec("node desktop_server2.mjs");
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
const MaxPort = 2008;   // --- RtcMaxport

const port = 3000;  // --- https Port

let producerList = {};  // --- key: Producer-WebRtcTransport.id, value: transport
let consumerList = {};  // --- key: Consumer-WebRtcTransport.id, value: transport

let directConsumerList = {};    // --- key: Producer-WebRtcTransport.id, value: transport

let direcrtDataTransport;       // --- Producer-directTransport
let plainProducerTransport;     // --- Producer-plainTransport

let sockTransportIdList = {};
/**
 *  key: Websocket Id, 
 *  value: {
 *      "producerId": transport.id, 
 *      "consumerScreenId": transport.id, 
 *      "consumerAudioId": transport.id, 
 *      "directConsumerId": transport.id
 * }
 */

let sockIdList = []; // --- Websocket Id

const limitClient = 2;

let desktopSocket;  // --- Desktop Server Socket

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
    console.log('https://' + ip_addr + ':' + port + '/rtc_client6.html');
})

// --- WebSocket Server ---

import { Server } from 'socket.io';
const io = new Server(httpsServer);

io.on('connection', sock => {

    sockTransportIdList[sock.id] = {};
    sockIdList.push(sock.id);

    if (sockIdList.length == 1) {
        desktopSocket = clientIO.connect('http://localhost:5900');
        createDirectProducer(desktopSocket);
        createPlainProducer(desktopSocket);
    }

    sock.on('getRtpCapabilities', (_, callback) => {
        //console.log("ListTotal: " + Object.keys(producerList).length);
        console.log("Total List: " + Object.keys(sockTransportIdList).length);
        if (Object.keys(sockTransportIdList).length > limitClient) {
            //console.log("sockIdList length: " + sockIdList.length);
            io.to(sockIdList[0]).emit("end");
        }

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
        createDirectConsumer(dataProducer.id, sock.id, desktopSocket);
    });


    // ----- Consumer WebRtcTransport -----

    sock.on('createConsumerTransport', async (req, callback) => {
        const { transport, params } = await mycreateWebRtcTransport();
        transport.observer.on('close', () => {
            transport.consumer.close();
            transport.consumer = null;
            delete consumerList[transport.id];
            transport = null;
        });
        callback(params);

        consumerList[transport.id] = transport;
        if (req == "screen") {
            sockTransportIdList[sock.id]["consumerScreenId"] = transport.id;
        } else if (req == "audio") {
            sockTransportIdList[sock.id]["consumerAudioId"] = transport.id;
        }
    });

    sock.on('connectConsumerTransport', async (req, callback) => {
        const transport = consumerList[req.transportId];
        await transport.connect({ dtlsParameters: req.dtlsParameters });
        callback({});
    });

    // --- use direcrtProducerId: direcrtDataTransport.producer.id
    sock.on('consumeScreen', async (req, callback) => {
        const transport = consumerList[req.transportId];
        const direcrtProducerId = direcrtDataTransport.producer.id

        const dataConsumer = await transport.consumeData({ dataProducerId: direcrtProducerId, });
        const params = {
            id: dataConsumer.id,
            dataProducerId: dataConsumer.dataProducerId,
            sctpStreamParameters: dataConsumer.sctpStreamParameters,
            label: dataConsumer.label,
            protocol: dataConsumer.protocol,
        };
        callback(params);

        transport.consumer = dataConsumer;

        //console.log("consumerList.length: " + Object.keys(consumerList).length);
    });

    ////////////////////////////////////////////////////////
    // --- use plainProducerId: plainTransport.producer.id
    sock.on('consumeAudio', async (req, callback) => {
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
        //console.log("consumer audio");
    });
    ////////////////////////////////////////////////////////


    sock.on("disconnect", () => {
        console.log("discconect id: " + sock.id);
        //console.log(JSON.stringify(sockTransportIdList[sock.id]));

        const producerId = sockTransportIdList[sock.id]["producerId"];
        const consumerScreenId = sockTransportIdList[sock.id]["consumerScreenId"];
        const directConsumerId = sockTransportIdList[sock.id]["directConsumerId"];
        const consumerAudioId = sockTransportIdList[sock.id]["consumerAudioId"];

        const directTransport = directConsumerList[directConsumerId];
        console.log("delete directConsumerTransportId: " + directTransport.id);
        directTransport.close();
        delete directConsumerList[producerId];

        const sendTransport = producerList[producerId];
        console.log("delete producerTransportId: " + sendTransport.id);
        sendTransport.close();
        delete producerList[producerId];

        const recvScreenTransport = consumerList[consumerScreenId];
        console.log("delete consumerScreenTransportId: " + recvScreenTransport.id);
        recvScreenTransport.close();
        delete consumerList[consumerScreenId];


        const recvAudioTransport = consumerList[consumerAudioId];
        console.log("delete consumerAudioTransportId: " + recvAudioTransport.id);
        recvAudioTransport.close();
        delete consumerList[consumerAudioId];


        delete sockTransportIdList[sock.id];
        const indexId = sockIdList.indexOf(sock.id);
        sockIdList.splice(indexId, 1);

        console.log("delete sockIdList length: " + sockIdList.length);

        if (sockIdList.length == 0) {
            const directTransport = direcrtDataTransport;
            console.log("delete directProducerTransportId: " + directTransport.id);
            directTransport.close();

            const plainTransport = plainProducerTransport;
            console.log("delete plainProducerTransportId: " + plainTransport.id);
            plainTransport.close();

            desktopSocket.disconnect();
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
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    }
];


async function startWorker() {
    worker = await mediasoup.createWorker(workerOption);
    router = await worker.createRouter({ mediaCodecs, });
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
async function createPlainProducer(socket) {
    const transport = await router.createPlainTransport(
        {
            listenIp: ip_addr,//'127.0.0.1',
            rtcpMux: false,
            comedia: true
        });

    plainProducerTransport = transport;

    // Read the transport local RTP port.
    const audioRtpPort = transport.tuple.localPort;
    //console.log("audioRtpPort: "+audioRtpPort);

    // Read the transport local RTCP port.
    const audioRtcpPort = transport.rtcpTuple.localPort;
    //console.log("audioRtcpPort: "+audioRtcpPort);

    const audioProducer = await transport.produce(
        {
            kind: 'audio',
            rtpParameters:
            {
                codecs:
                    [
                        {
                            mimeType: 'audio/opus',
                            clockRate: 48000,
                            payloadType: 101,
                            channels: 2,
                            rtcpFeedback: [],
                            parameters: { sprop_stereo: 1 }
                        }
                    ],
                encodings: [{ ssrc: 11111111 }]
            }
        });

    transport.producer = audioProducer;

    //console.log("plainProducerId: "+plainProducerTransport.producer.id);

    socket.emit('audio', { "rtp": audioRtpPort, "rtcp": audioRtcpPort, "ip_addr": ip_addr });
}


// --- Producer DirectTransport ---
async function createDirectProducer(socket) {
    const transport = await router.createDirectTransport();
    direcrtDataTransport = transport;
    const dataProducer = await transport.produceData();
    transport.producer = dataProducer;

    //console.log("directDataTransport produce id: " + transport.producer.id);

    let width;
    let height;
    let depth;
    let fb_bpp;

    socket.on('screenData', data => {
        width = data.width;
        height = data.height;
        depth = data.depth;
        fb_bpp = data.fb_bpp;
    })

    socket.on('img', data => {
        if (width && height && depth && fb_bpp) {
            const imgJpeg = converter.convert(data, width, height, depth, fb_bpp);
            dataProducer.send(imgJpeg);
        }
    });
}

// --- Consumer DirectTransport ---
async function createDirectConsumer(dataProducerId, sockId, socket) {
    //console.log("createDirectConsumer");
    const transport = await router.createDirectTransport();
    directConsumerList[transport.id] = transport;
    sockTransportIdList[sockId]["directConsumerId"] = transport.id;

    const dataConsumer = await transport.consumeData({ dataProducerId: dataProducerId });
    transport.consumer = dataConsumer;

    dataConsumer.on("message", msg => {
        socket.emit('data', msg);
    });
}


startWorker();
