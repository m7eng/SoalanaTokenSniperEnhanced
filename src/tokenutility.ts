import axios from "axios";
import dotenv from "dotenv";
import { config } from "./config";
import { time } from "console";
import { newTokenListing as NewTokenListing } from "./types";

dotenv.config();

const brdeyeBaseURL = process.env.BRDY_HTTPS_URI || "";
const brdeyeApiKey = process.env.BRDY_API_KEY || "";

// Get token price from BirdEye
export async function getPriceThruBirdeye(tokenMint: string, persistent: boolean): Promise<string> {

    const options = {
        headers: {
            Accept: 'application/json',
            'x-chain': 'solana',
            'X-API-KEY': brdeyeApiKey
        }
    };

    let brideyeRes: any;
    while (!brideyeRes) {
        try {
            brideyeRes = await axios.get(`${brdeyeBaseURL}/defi/price?address=${tokenMint}`, options);
            if (brideyeRes)
                await new Promise(resolve => setTimeout(resolve, config.scan_options.price_ratelimit_ms));
                break;
        } catch (error) {
            console.log(`Error fetching price from BirdEye: ${error}`);
            if (!persistent) {
                return "";
            }
        }
        await new Promise(resolve => setTimeout(resolve, config.scan_options.price_ratelimit_ms));
    }
    const tokenCurrentPrice = brideyeRes.data.data.value;
    
    return tokenCurrentPrice;
}

// Get new token listing from BirdEye
export async function getNewToken(): Promise<NewTokenListing | null> {
    const options = {
        headers: {
            Accept: 'application/json',
            'x-chain': 'solana',
            'X-API-KEY': brdeyeApiKey
        }
    };

    const timestampInSeconds: number = Math.floor(Date.now() / 1000);
    const reqTimeStamp = timestampInSeconds - config.scan_options.min_age_of_token;
    try {
        const brideyeRes = await axios.get(`${brdeyeBaseURL}/defi/v2/tokens/new_listing?time_to=${reqTimeStamp}&limit=${config.scan_options.max_token_fetch}&meme_platform_enabled=${!config.rug_check.ignore_pump_fun}`, options);
        const newToken: NewTokenListing = brideyeRes.data;
        return newToken;
    } catch (error) {
        console.log(`Error fetching new token from BirdEye: ${error}`);

    }
    return null;
}


// Not useed at but may be in future
export async function getTokenSecurity(tokenMint: string): Promise<any> {
    const options = {
        headers: {
            Accept: 'application/json',
            'x-chain': 'solana',
            'X-API-KEY': brdeyeApiKey
        }
    };

    try {
        const brideyeRes = await axios.get(`${brdeyeBaseURL}/defi/v2/token_security?address=${tokenMint}`, options);

        return brideyeRes;
    } catch (error) {
        console.log(`Error fetching new token from BirdEye: ${error}`);

    }
    return null;
}