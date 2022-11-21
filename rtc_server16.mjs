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


exec("node desktop_server2.mjs 5900");
//exec("node desktop_server2.mjs 5902");
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

let directConsumerList = {};    // --- key: Producer-WebRtcTransport.id, value: transport

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

let desktopList = {};  
/**
 * key: desktop_address, 
 * value: {
 *  desktopSocket, 
 *  screenTransport, 
 *  audioTransport
 * }
 */


//const desktop_address = "http://localhost:5900";

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
    console.log('https://' + ip_addr + ':' + port + '/rtc_client7.html');
})

// --- WebSocket Server ---

import { Server } from 'socket.io';
const io = new Server(httpsServer);

io.on('connection', sock => {

    sockTransportIdList[sock.id] = {};
    sockIdList.push(sock.id);

    sock.on('getRtpCapabilities', (req, callback) => {
        console.log("ProducerListTotal: " + Object.keys(producerList).length);
        console.log("Total List: " + Object.keys(sockTransportIdList).length);
        if (Object.keys(sockTransportIdList).length > limitClient) {
            //console.log("sockIdList length: " + sockIdList.length);
            io.to(sockIdList[0]).emit("end");
        }

        if (sockTransportIdList[sock.id][req] != undefined) {
            console.log("already created transports");
            
            const producerId = sockTransportIdList[sock.id][req]["producerId"];
            const consumerScreenId = sockTransportIdList[sock.id][req]["consumerScreenId"];

            const directTransport = directConsumerList[producerId];
            console.log("delete directConsumerTransportId: " + directTransport.id);
            directTransport.close();
            delete directConsumerList[producerId];

            const sendTransport = producerList[producerId];
            console.log("delete producerTransportId: " + sendTransport.id);
            sendTransport.close();
            delete producerList[producerId];

            const recvTransport = consumerList[consumerScreenId];
            console.log("delete consumerTransportId: " + recvTransport.id);
            recvTransport.close();
            delete consumerList[consumerScreenId];
        } else if (desktopList[req] == undefined) {
            desktopList[req] = {};
            desktopList[req]['desktopSocket'] = clientIO.connect(req);
            createDirectProducer(req, desktopList[req]['desktopSocket']);
        }

        sockTransportIdList[sock.id][req] = {};

        callback(router.rtpCapabilities);
        console.log(req);
    });

    // ----- Producer WebRtcTransport-----

    sock.on('createProducerTransport', async (req, callback) => {
        const { transport, params } = await mycreateWebRtcTransport();
        transport.observer.on('close', () => {
            transport.producer.close();
            transport.producer = null;
            delete producerList[transport.id];
            transport = null;
        });
        callback(params);

        producerList[transport.id] = transport;
        sockTransportIdList[sock.id][req]["producerId"] = transport.id;
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
        createDirectConsumer(dataProducer.id, transport.id, desktopList[req.desktop_address]['desktopSocket']);
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
        if(req['type'] == "screen"){
            sockTransportIdList[sock.id][req['desktop_address']]["consumerScreenId"] = transport.id;
        } else if (req['type'] == "audio"){
            sockTransportIdList[sock.id][req['desktop_address']]["consumerAudioId"] = transport.id;
        }
    });

    sock.on('connectConsumerTransport', async (req, callback) => {
        const transport = consumerList[req.transportId];
        await transport.connect({ dtlsParameters: req.dtlsParameters });
        callback({});
    });

    // --- use direcrtProducerId: screenTransport.producer.id
    sock.on('consumeScreen', async (req, callback) => {
        const transport = consumerList[req.transportId];
        const direcrtProducerId = desktopList[req.desktop_address]['screenTransport'].producer.id;

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


    sock.on("disconnect", () => {
        console.log("discconect id: " + sock.id);
        //console.log(JSON.stringify(sockTransportIdList[sock.id]));

        Object.entries(sockTransportIdList[sock.id]).map(([_, value]) => {
            const producerId = value["producerId"];
            const consumerScreenId = value["consumerScreenId"];

            const directTransport = directConsumerList[producerId];
            console.log("delete directConsumerTransportId: " + directTransport.id);
            directTransport.close();
            delete directConsumerList[producerId];

            const sendTransport = producerList[producerId];
            console.log("delete producerTransportId: " + sendTransport.id);
            sendTransport.close();
            delete producerList[producerId];

            const recvTransport = consumerList[consumerScreenId];
            console.log("delete consumerTransportId: " + recvTransport.id);
            recvTransport.close();
            delete consumerList[consumerScreenId];
        });

        delete sockTransportIdList[sock.id];
        const indexId = sockIdList.indexOf(sock.id);
        sockIdList.splice(indexId, 1);

        console.log("delete sockIdList length: " + sockIdList.length);

        if (sockIdList.length == 0) {
            Object.entries(desktopList).map(([key, value]) => {
                const directTransport = value['screenTransport'];
                console.log("delete directScreenProducerTransportId: " + directTransport.id);
                directTransport.close();
                //delete value['screenTransport'];

                const desktopSocket = value['desktopSocket'];
                desktopSocket.disconnect();
                //delete value['desktopSocket'];

                delete desktopList[key];
            });
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


// --- Producer DirectTransport ---
async function createDirectProducer(desktop_address,desktopSocket) {
    const transport = await router.createDirectTransport();
    
    desktopList[desktop_address]['screenTransport'] = transport;
    const dataProducer = await transport.produceData();
    transport.producer = dataProducer;
    
    //console.log("directDataTransport produce id: " + transport.producer.id);

    let width;
    let height;
    let depth;
    let fb_bpp;

    desktopSocket.on('screenData', data => {
        width = data.width;
        height = data.height;
        depth = data.depth;
        fb_bpp = data.fb_bpp;
    })

    desktopSocket.on('img', data => {
        if(width && height && depth && fb_bpp){
            const imgJpeg = converter.convert(data, width, height, depth, fb_bpp);
            dataProducer.send(imgJpeg);
        }
    });
}

// --- Consumer DirectTransport ---
async function createDirectConsumer(dataProducerId, transportId, desktopSocket) {
    //console.log("createDirectConsumer");
    const transport = await router.createDirectTransport();
    directConsumerList[transportId] = transport;

    const dataConsumer = await transport.consumeData({ dataProducerId: dataProducerId });
    transport.consumer = dataConsumer;

    dataConsumer.on("message", msg => {
        desktopSocket.emit('data', msg);
    });
}


startWorker();
