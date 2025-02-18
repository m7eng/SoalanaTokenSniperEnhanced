import WebSocket from "ws"; // Node.js websocket library
import { WebSocketRequest, newTokenListing } from './types'; // Typescript Types for type safety
import { config } from "./config"; // Configuration parameters for our bot
import { fetchTransactionDetails, createSwapTransaction, getRugCheckConfirmed, fetchAndSaveSwapDetails, parseIndividualSolanaSignature } from "./transactions";
import { validateEnv } from "./utils/env-validator";
import { getNewToken, getTokenSecurity } from "./tokenutility";
import { selectAllHoldings, selectAllTokens, selectTokenByName, selectTokenByNameAndCreator } from "./tracker/db";
import * as fs from "fs";

// Regional Variables
const logFilePath = "./logs/tracker.log";
let activeTransactions = 0;
const MAX_CONCURRENT = config.tx.concurrent_transactions;
let init = false;

// LogFile
const saveToLog = (message: string): void => {
  fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`, "utf8");
};


// Function used to handle the transaction once a new pool creation is found
async function processTransaction(tokenMint: string | null, symbol: string | null, signature: string | null): Promise<void> {
  let solMint = config.liquidity_pool.wsol_pc_mint;
  let newTokenMint = "";
  let newSymbol = "";

  if (!signature) {
    // Output logs
    newTokenMint = tokenMint ?? "";
    newSymbol = symbol ?? "";
    console.log(`👀 New Token found:  ${newSymbol} - ${newTokenMint}`);

  } else {
    console.log("=============================================");
    console.log("🔎 New Liquidity Pool found.");
    console.log("🔃 Fetching transaction details ...");
    // Fetch the transaction details  
    const data = await fetchTransactionDetails(signature);

    if (!data) {
      console.log("⛔ Transaction aborted. No data returned.");
      console.log("🟢 Resuming looking for new tokens...\n");
      return;
    }

    if(!data.tokenMint)
      return;
    newTokenMint = data.tokenMint;
    console.log("🟢 Token found:", newTokenMint);


  }
  // Check rug check
  const isRugCheckPassed = await getRugCheckConfirmed(newTokenMint);
  if (!isRugCheckPassed) {
    console.log("🚫 Rug Check not passed! Transaction aborted.");
    return;
  }

  // Handle ignored tokens
  if (newTokenMint.trim().toLowerCase().endsWith("pump") && config.rug_check.ignore_pump_fun) {
    // Check if ignored
    console.log("🚫 Transaction skipped. Ignoring Pump.fun.");
    return;
  }

  // Ouput logs
  console.log("👽 GMGN: https://gmgn.ai/sol/token/" + newTokenMint);

  // Check if simulation mode is enabled
  if (config.swap.simulation_mode) {
    console.log("👀 Simulation mode is enabled. Token swap will be simulated.");
  }

  // Add initial delay before first buy
  await new Promise((resolve) => setTimeout(resolve, config.tx.swap_tx_initial_delay));

  // Create Swap transaction
  const tx = await createSwapTransaction(solMint, newTokenMint);

  if (!tx) {
    console.log("⛔ Transaction aborted due to reasons ¯\\_(ツ)_/¯");

    return;
  }

  // Output logs
  console.log("🚀 Swapping SOL for Token.");
  if (!config.swap.simulation_mode) {
    console.log("Swap Transaction: ", "https://solscan.io/tx/" + tx);
  } else {
    console.log("Swap Transaction: ", "SIMULATED");
  }

  // Fetch and store the transaction for tracking purposes
  const saveConfirmation = await fetchAndSaveSwapDetails(tx);


  if (!saveConfirmation) {
    console.log("❌ Warning: Transaction not saved for tracking! Track Manually!");

  }



}

// Birdeye token search for unbonded coins
async function birdEyeTokenSeeker(): Promise<void> {

  while (true) {

    // Check for max token holdings
    const allTokens = await selectAllHoldings();

    if (allTokens.length >= config.swap.max_token_holdings) {
      console.log("🚫 Max token holdings reached, skipping...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    console.log("==========================================================================================");
    console.log("🟢 Looking for new tokens...");
    console.log("==========================================================================================");
    const newToken = await getNewToken();

    if (newToken) {

      for (const item of newToken.data.items) {
        // Check for already known names
        if (config.rug_check.block_returning_token_names) {
          const duplicate = await selectTokenByName(item.name);
          if (duplicate.length !== 0) {
            console.log("🚫 No new tokens...")
            continue;
          }
        }

        await processTransaction(item.address, item.symbol, null);
        await new Promise(resolve => setTimeout(resolve, config.scan_options.tsproc_ratelimit_ms));
      }
    } else {
      console.log("⏳ Max concurrent transactions reached, skipping...");
    }

  }

}

// Function used to open our websocket connection
function sendSubscribeRequestRadiyiumProgram(ws: WebSocket): void {
  const request: WebSocketRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "logsSubscribe",
    params: [
      {
        mentions: [config.liquidity_pool.radiyum_program_id],
      },
      {
        commitment: "processed", // Can use finalized to be more accurate.
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

function sendSubscribeRequestMigration(ws: WebSocket): void {
  const request: WebSocketRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "logsSubscribe",
    params: [
      {
        mentions: [config.programs.pump_raydium_migration],
      },
      {
        commitment: "processed", // Can use finalized to be more accurate.
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

// Websocket Handler for listening to the Solana logSubscribe method
async function rpcTokenSeeker(): Promise<void> {
  // Load environment variables from the .env file
  const env = validateEnv();

  // Create a WebSocket connection
  let ws: WebSocket | null = new WebSocket(env.HELIUS_WSS_URI);
  if (!init) console.clear();

  // Send subscription to the websocket once the connection is open
  ws.on("open", () => {
    // Subscribe
    if (ws) sendSubscribeRequestRadiyiumProgram(ws); // Send a request once the WebSocket is open
    console.log("\n🔓 WebSocket is open and listening.");
    init = true;
  });

  // Logic for the message event for the .on event listener
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString(); // Convert data to a string
      const parsedData = JSON.parse(jsonString); // Parse the JSON string

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error("🚫 RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signtature
      if (!Array.isArray(logs) || !signature) return;

      // Verify if this is a new pool creation
      const containsCreate = logs.some((log: string) => typeof log === "string" && log.includes("Program log: initialize2: InitializeInstruction2"));
      if (!containsCreate || typeof signature !== "string") return;

      // Verify if we have reached the max concurrent transactions
      if (activeTransactions >= MAX_CONCURRENT) {
        console.log("⏳ Max concurrent transactions reached, skipping...");
        return;
      }

      // Add additional concurrent transaction
      activeTransactions++;

      // Process transaction asynchronously
      processTransaction(null, null, signature)
        .catch((error) => {
          console.error("Error processing transaction:", error);
        })
        .finally(() => {
          activeTransactions--;
        });
    } catch (error) {
      console.error("💥 Error processing message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("📴 WebSocket connection closed, cleaning up...");
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    console.log("🔄 Attempting to reconnect in 5 seconds...");
    setTimeout(rpcTokenSeeker, 5000);
  });
}


// Token search on Pump.fun
async function pumpFunTokenSeeker(): Promise<void> {
  if (!init) console.clear();


  /**
   *  Create a WebSocket connection
   */
  const parseTxUrl = process.env.HELIUS_WSS_URI || "";
  let ws: WebSocket | null = new WebSocket(parseTxUrl);

  /**
   *  Send subscription to the websocket once the connection is open, in order to subscribe to logSubscribe
   */
  ws.on("open", () => {
    if (ws) sendSubscribeRequestMigration(ws);
    console.log("\n🔓 WebSocket is open and listening.");
    init = true;
  });

  /**
   *  Proceed with logic when we receive a message from the websocket stream
   */
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString(); // Convert data to a string
      const parsedData = JSON.parse(jsonString); // Parse the JSON string

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error("🚫 RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signtature
      if (!Array.isArray(logs) || !signature) return;

      //Verify if this is a liquidity removal from pump fun
      const containsCreate = logs.some((log: string) => typeof log === "string" && log.includes("Program log: Instruction: Withdraw"));
      if (!containsCreate || typeof signature !== "string") return;

      // Process transaction asynchronously
      processTransaction(null, null, signature).catch((error) => {
        console.error("Error processing transaction:", error);
      });
    } catch (error) {
      console.error("💥 Error processing websocket message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   *  Handle other states like error and close.
   */
  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });
  ws.on("close", () => {
    console.log("📴 WebSocket connection closed, cleaning up...");
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    console.log("🔄 Attempting to reconnect in 5 seconds...");
    setTimeout(pumpFunTokenSeeker, 5000);
  });
}

if (config.scan_options.token_search_engine === "helius") {
  // Start rpcTokenSeeker
  rpcTokenSeeker().catch((err) => {
    console.error(err.message);
  });
}

if (config.scan_options.token_search_engine === "birdEye") {
  // Start birdEyeTokenSeeker
  birdEyeTokenSeeker().catch((err) => {
    console.error(err.message);
  });
}

if (config.scan_options.token_search_engine === "pumpfun") {
  // Start birdEyeTokenSeeker
  pumpFunTokenSeeker().catch((err) => {
    console.error(err.message);
  });
}