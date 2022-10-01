'use strict';

// --- ES modules ---
import nutjs from "@nut-tree/nut-js";
const { mouse, Point, Button, keyboard, Key, screen, ColorMode } = nutjs;
import Jimp from "jimp";

import { createSocket } from "dgram";

import screenshot from 'screenshot-desktop';
import https from 'httpolyglot';
import fs from 'fs';
import express from 'express';
import mediasoup from 'mediasoup';
import { networkInterfaces } from "os";

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

function getIpAddress() {
    const nets = networkInterfaces();
    const net = nets["eth0"]?.find((v) => v.family == "IPv4");
    return net.address;
}

const ip_addr = getIpAddress(); // --- IP Address
const port = 3000;  // --- https Port

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

async function startWorker() {
    worker = await mediasoup.createWorker(workerOption);
    router = await worker.createRouter({});
    createDirectProducer();
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
async function createDirectProducer() {
    const transport = await router.createDirectTransport();
    const dataProducer = await transport.produceData();

    direcrtDataProducerId = dataProducer.id;

    
}