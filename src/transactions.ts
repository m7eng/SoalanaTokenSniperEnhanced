import axios from "axios";
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import dotenv from "dotenv";
import { config } from "./config";
import {
  TransactionDetailsResponseArray,
  MintsDataReponse,
  QuoteResponse,
  SerializedQuoteResponse,
  SwapEventDetailsResponse,
  HoldingRecord,
  RugResponseExtended,
  NewTokenRecord,
  createSellTransactionResponse,
  MintReponse,
  EnrichedTransactionReponseArray,
} from "./types";
import { insertHolding, insertNewToken, removeHolding, selectTokenByMint, selectTokenByNameAndCreator } from "./tracker/db";
import { getPriceThruBirdeye } from "./tokenutility";
import * as fs from "fs";

// Load environment variables from the .env file
dotenv.config();


// LogFile
const logFilePath = "./src/logs/tracker.log";

const saveToLogFile = (message: string): void => {
  fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`, "utf8");
};

export async function fetchTransactionDetails(signature: string): Promise<MintsDataReponse | null> {
  // Set function constants
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  const maxRetries = config.tx.fetch_tx_max_retries;

  let retryCount = 0;

  // Add longer initial delay to allow transaction to be processed
  console.log("Waiting " + config.tx.fetch_tx_initial_delay / 1000 + " seconds for transaction to be confirmed...");
  await new Promise((resolve) => setTimeout(resolve, config.tx.fetch_tx_initial_delay));

  while (retryCount < maxRetries) {
    try {
      // Output logs
      console.log(`Attempt ${retryCount + 1} of ${maxRetries} to fetch transaction details...`);

      const response = await axios.post<any>(
        txUrl,
        {
          transactions: [signature],
          commitment: "finalized",
          encoding: "jsonParsed",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: config.tx.get_timeout,
        }
      );

      // Verify if a response was received
      if (!response.data) {
        throw new Error("No response data received");
      }

      // Verify if the response was in the correct format and not empty
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("Response data array is empty");
      }

      // Access the `data` property which contains the array of transactions
      const transactions: TransactionDetailsResponseArray = response.data;

      // Verify if transaction details were found
      if (!transactions[0]) {
        throw new Error("Transaction not found");
      }

      // Access the `instructions` property which contains account instructions
      const instructions = transactions[0].instructions;
      if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
        throw new Error("No instructions found in transaction");
      }

      // Verify and find the instructions for the correct market maker id
      const instruction = instructions.find((ix) => ix.programId === config.liquidity_pool.radiyum_program_id);
      if (!instruction || !instruction.accounts) {
        throw new Error("No market maker instruction found");
      }
      if (!Array.isArray(instruction.accounts) || instruction.accounts.length < 10) {
        throw new Error("Invalid accounts array in instruction");
      }

      // Store quote and token mints
      const accountOne = instruction.accounts[8];
      const accountTwo = instruction.accounts[9];

      // Verify if we received both quote and token mints
      if (!accountOne || !accountTwo) {
        throw new Error("Required accounts not found");
      }

      // Set new token and SOL mint
      let solTokenAccount = "";
      let newTokenAccount = "";
      if (accountOne === config.liquidity_pool.wsol_pc_mint) {
        solTokenAccount = accountOne;
        newTokenAccount = accountTwo;
      } else {
        solTokenAccount = accountTwo;
        newTokenAccount = accountOne;
      }

      // Output logs
      console.log("Successfully fetched transaction details!");
      console.log(`SOL Token Account: ${solTokenAccount}`);
      console.log(`New Token Account: ${newTokenAccount}`);

      const displayData: MintsDataReponse = {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
      };

      return displayData;
    } catch (error: any) {
      console.log(`Attempt ${retryCount + 1} failed: ${error.message}`);

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(4000 * Math.pow(1.5, retryCount), 15000);
        console.log(`Waiting ${delay / 1000} seconds before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("All attempts to fetch transaction details failed");
  return null;
}

export async function parseIndividualSolanaSignature(signature: string): Promise<MintReponse> {
  console.log(`🌍 Trying to fetch signature": ${signature}`);

  /**
   *  Check the verbose logging state in config.ts
   */
  const verboseLogs = config.settings.parse_signature.verbose_logging || false;

  /**
   *  Get the url for the service that will use to parse this signature.
   *  For this example we will use the "Enhanced Transactions API" from helius.
   *  You can find more information here: https://docs.helius.dev/solana-apis/enhanced-transactions-api/parse-transaction-s
   */
  const parseTxUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  if (verboseLogs) console.log(`VERBOSE: Connect to the "Enhanced Transactions API":\n ${parseTxUrl}`);

  /**
   *  Set the amount of retries the script should to for fetching this parsed information for this signature.
   *  We call this maxRetries and pull in the value set in the config.ts file.
   *  We will initialize a variable called "maxRetriesCount" the will keep count of the maxRetries
   */
  const maxRetries = config.settings.parse_signature.maxRetries;
  let maxRetriesCount = 0;

  /**
   *  Wait for an initial delay set in our config.ts file
   */
  const intialDelay = config.settings.parse_signature.initial_delay || 3000;
  await new Promise((resolve) => setTimeout(resolve, intialDelay));

  /**
   *  Proceed with trying to fetch the parsed signature details using the "Enhanced Transactions API".
   */
  while (maxRetriesCount < maxRetries) {
    try {
      /**
       *  Output the number of attempts if verbose logging is enabled
       */
      if (verboseLogs) console.log(`VERBOSE: Attempt ${maxRetriesCount + 1} of ${maxRetries} to fetch parsed signature data.`);

      /**
       *  This request will return an array of enriched, human-readable transactions of the given transaction signatures and store it in the reponse variable.
       *  The commitment refers to hiw finalized a block must be to be included in the search.
       *  If not provided, will default to "finalized" commitment. Note that "processed" level commitment is not supported. Options: finalized, confirmed
       */
      const response = await axios.post<any>(
        parseTxUrl,
        {
          transactions: [signature],
          commitment: "confirmed",
          encoding: "jsonParsed",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: config.settings.parse_signature.request_timeout,
        }
      );

      /**
       *  Verify if any data was returned. If not throw an error that will be catched by the try-catch statement.
       */
      if (!response.data) {
        throw new Error("🚫 No reponse data was received from the Enhanced Transactions API.");
      }

      /**
       *  Verify if the response was in the correct format and not empty. If not throw an error that will be catched by the try-catch statement.
       */
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("🚫 The reponse data array received from the Enhanced Transactions API is empty.");
      }

      /**
       *  Store the reponse data into the interface type for response from "Enhanced Transactions API" from Helius.
       *  Once stored in the enrichedTransaction variable, you can access the `data` property safely.
       */
      const enrichedTransaction: EnrichedTransactionReponseArray = response.data;

      /**
       *  Verify if transaction details were found. If not throw an error that will be catched by the try-catch statement.
       */
      if (!enrichedTransaction[0]) {
        throw new Error("🚫 The reponse data array stored in enrichedTransaction is empty.");
      }

      /**
       *  Store the token transfers, type and source for this enriched transaction into its own variable
       */
      const enrichedTokenTransfers = enrichedTransaction[0].tokenTransfers;
      const enrichedType = enrichedTransaction[0].type;
      const enrichedSource = enrichedTransaction[0].source;

      /**
       *  Verify if this was an actual WITHDRAW from PUMP_FUN
       */
      if (enrichedType !== "WITHDRAW" || enrichedSource !== "PUMP_FUN") {
        throw new Error("🚫 The reponse data array received from the Enhanced Transactions API is not a valid PUMP_FUN WITHDRAW.");
      }

      /**
       *  Verify if the tokenTransfers was stored in the correct format and not empty. If not throw an error that will be catched by the try-catch statement.
       */
      if (!enrichedTokenTransfers || !Array.isArray(enrichedTokenTransfers) || enrichedTokenTransfers.length === 0) {
        throw new Error("🚫 The reponse data array received from the Enhanced Transactions API does not contain token transfers.");
      }

      /**
       *  Extract the mint from enrichedTokenTransfers
       */
      const mint = enrichedTokenTransfers[0].mint;

      /**
       *  Verify if we received an actual mint. If not throw an error that will be catched by the try-catch statement.
       */
      if (!mint) {
        throw new Error("🚫 The token transfers did not contain a valid mint.");
      }

      /**
       *  Create an object based on the MintReponse interface type to return back to our index script.
       */
      const mintReponse: MintReponse = {
        tokenMint: mint,
        success: true,
        msg: "success",
      };
      return mintReponse;
    } catch (error: any) {
      if (verboseLogs) console.log(`VERBOSE: Attempt ${maxRetriesCount + 1} failed: ${error.message}`);
      maxRetriesCount++;

      if (maxRetriesCount < maxRetries) {
        const delay = Math.min(4000 * Math.pow(1.5, maxRetriesCount), 15000);
        if (verboseLogs) console.log(`VERBOSE: Waiting ${delay / 1000} seconds before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   *  Return that all attempts failed.
   */
  const mintReponse: MintReponse = {
    tokenMint: undefined,
    success: false,
    msg: "🚫 All attempts to fetch parsed signature data from the Enhanced Transactions API failed.",
  };
  return mintReponse;
}

export async function createSwapTransaction(solMint: string, tokenMint: string): Promise<string | null> {
  const quoteUrl = process.env.JUP_HTTPS_QUOTE_URI || "";
  const swapUrl = process.env.JUP_HTTPS_SWAP_URI || "";
  const rpcUrl = process.env.HELIUS_HTTPS_URI || "";
  let quoteResponseData: QuoteResponse | null = null;
  let serializedQuoteResponseData: SerializedQuoteResponse | null = null;
  const connection = new Connection(rpcUrl);
  const myWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.PRIV_KEY_WALLET || "")));
  // Get Swap Quote
  let retryCount = 0;
  while (retryCount < config.swap.token_not_tradable_400_error_retries) {
    try {
      // Request a quote in order to swap SOL for new token
      console.log(solMint, tokenMint);
      const quoteResponse = await axios.get<QuoteResponse>(quoteUrl, {
        params: {
          inputMint: solMint,
          outputMint: tokenMint,
          amount: config.swap.amount,
          slippageBps: config.swap.slippageBps,
        },
        timeout: config.tx.get_timeout,
      });

      if (!quoteResponse.data) return null;

      if (config.swap.verbose_log && config.swap.verbose_log === true) {
        console.log("\nVerbose log:");
        console.log(quoteResponse.data);
      }

      quoteResponseData = quoteResponse.data; // Store the successful response
      break;
    } catch (error: any) {
      // Retry when error is TOKEN_NOT_TRADABLE
      if (error.response && error.response.status === 400) {
        const errorData = error.response.data;
        if (errorData.errorCode === "TOKEN_NOT_TRADABLE") {
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, config.swap.token_not_tradable_400_error_delay));
          continue; // Retry
        }
      }

      // Throw error (null) when error is not TOKEN_NOT_TRADABLE
      console.error("Error while requesting a new swap quote:", error.message);
      if (config.swap.verbose_log && config.swap.verbose_log === true) {
        console.log("Verbose Error Message:");
        if (error.response) {
          // Server responded with a status other than 2xx
          console.error("Error Status:", error.response.status);
          console.error("Error Status Text:", error.response.statusText);
          console.error("Error Data:", error.response.data); // API error message
          console.error("Error Headers:", error.response.headers);
        } else if (error.request) {
          // Request was made but no response was received
          console.error("No Response:", error.request);
        } else {
          // Other errors
          console.error("Error Message:", error.message);
        }
      }
      return null;
    }
  }

  if (quoteResponseData) console.log("✅ Swap quote recieved.");

  // Serialize the quote into a swap transaction that can be submitted on chain
  try {
    if (!quoteResponseData) return null;

    const swapResponse = await axios.post<SerializedQuoteResponse>(
      swapUrl,
      JSON.stringify({
        // quoteResponse from /quote api
        quoteResponse: quoteResponseData,
        // user public key to be used for the swap
        userPublicKey: myWallet.publicKey.toString(),
        // auto wrap and unwrap SOL. default is true
        wrapAndUnwrapSol: true,
        //dynamicComputeUnitLimit: true, // allow dynamic compute limit instead of max 1,400,000
        dynamicSlippage: {
          // This will set an optimized slippage to ensure high success rate
          maxBps: 300, // Make sure to set a reasonable cap here to prevent MEV
        },
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: config.swap.prio_fee_max_lamports,
            priorityLevel: config.swap.prio_level,
          },
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.tx.get_timeout,
      }
    );
    if (!swapResponse.data) return null;

    if (config.swap.verbose_log && config.swap.verbose_log === true) {
      console.log(swapResponse.data);
    }

    serializedQuoteResponseData = swapResponse.data; // Store the successful response
  } catch (error: any) {
    console.error("Error while sending the swap quote:", error.message);
    if (config.swap.verbose_log && config.swap.verbose_log === true) {
      console.log("Verbose Error Message:");
      if (error.response) {
        // Server responded with a status other than 2xx
        console.error("Error Status:", error.response.status);
        console.error("Error Status Text:", error.response.statusText);
        console.error("Error Data:", error.response.data); // API error message
        console.error("Error Headers:", error.response.headers);
      } else if (error.request) {
        // Request was made but no response was received
        console.error("No Response:", error.request);
      } else {
        // Other errors
        console.error("Error Message:", error.message);
      }
    }
    return null;
  }

  if (serializedQuoteResponseData) console.log("✅ Swap quote serialized.");

  // deserialize, sign and send the transaction
  try {
    if (!serializedQuoteResponseData) return null;
    const swapTransactionBuf = Buffer.from(serializedQuoteResponseData.swapTransaction, "base64");
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    transaction.sign([myWallet.payer]);

    // get the latest block hash
    const latestBlockHash = await connection.getLatestBlockhash();

    // Execute the transaction
    let txid = "";
    if (!config.swap.simulation_mode) {
      const rawTransaction = transaction.serialize();
      txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true, // If True, This will skip transaction simulation entirely.
        maxRetries: 2,
      });
    } else {

      // Simulate txid but put information for fetchAndSaveSwapDetails() in
      txid = JSON.stringify({
        tokenMint: tokenMint,
        paidSol: config.swap.amount,
      })

    }
    // Return null when no tx was returned
    if (!txid) {
      console.log("🚫 No id received for sent raw transaction.");
      return null;
    }

    if (txid) console.log("✅ Raw transaction id received.");

    // Fetch the current status of a transaction signature (processed, confirmed, finalized).
    // Ignore this check in simulation mode
    if (!config.swap.simulation_mode) {
      const conf = await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: txid,
      });


      if (txid) console.log("🔎 Checking transaction confirmation ...");

      // Return null when an error occured when confirming the transaction
      if (conf.value.err || conf.value.err !== null) {
        console.log("🚫 Transaction confirmation failed.");
        return null;
      }
    }
    return txid;
  } catch (error: any) {
    console.error("Error while signing and sending the transaction:", error.message);
    if (config.swap.verbose_log && config.swap.verbose_log === true) {
      console.log("Verbose Error Message:");
      if (error.response) {
        // Server responded with a status other than 2xx
        console.error("Error Status:", error.response.status);
        console.error("Error Status Text:", error.response.statusText);
        console.error("Error Data:", error.response.data); // API error message
        console.error("Error Headers:", error.response.headers);
      } else if (error.request) {
        // Request was made but no response was received
        console.error("No Response:", error.request);
      } else {
        // Other errors
        console.error("Error Message:", error.message);
      }
    }
    return null;
  }
}

export async function getRugCheckConfirmed(tokenMint: string): Promise<boolean> {




  let rugResponse: any;
  const jwtToken = process.env.RUGCHECK_JWT || "";
  try {
    rugResponse = await axios.get<RugResponseExtended>("https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report", {
      timeout: config.tx.get_timeout,
      /* headers: {
        "Authorization": `Bearer ${jwtToken}`, // JWT im Header mitschicken
        "Content-Type": "application/json"
      } */
    });
  } catch (error: any) {
    console.error("🚫 Error while fetching the rugcheck report:", error.message);
    return false;
  }
  if (!rugResponse.data) return false;

  if (config.rug_check.verbose_log && config.rug_check.verbose_log === true) {
    console.log(rugResponse.data);
  }

  // Extract information
  const tokenReport: RugResponseExtended = rugResponse.data;
  const tokenCreator = tokenReport.creator ? tokenReport.creator : tokenMint;
  const mintAuthority = tokenReport.token.mintAuthority;
  const freezeAuthority = tokenReport.token.freezeAuthority;
  const isInitialized = tokenReport.token.isInitialized;
  const supply = tokenReport.token.supply;
  const decimals = tokenReport.token.decimals;
  const tokenName = tokenReport.tokenMeta.name;
  const tokenSymbol = tokenReport.tokenMeta.symbol;
  const tokenMutable = tokenReport.tokenMeta.mutable;
  let topHolders = tokenReport.topHolders;
  const marketsLength = tokenReport.markets ? tokenReport.markets.length : 0;
  const totalLPProviders = tokenReport.totalLPProviders;
  const totalMarketLiquidity = tokenReport.totalMarketLiquidity;
  const isRugged = tokenReport.rugged;
  const rugScore = tokenReport.score;
  const rugRisks = tokenReport.risks
    ? tokenReport.risks
    : [
      {
        name: "Good",
        value: "",
        description: "",
        score: 0,
        level: "good",
      },
    ];




  // Update topholders if liquidity pools are excluded
  if (config.rug_check.exclude_lp_from_topholders) {
    // local types
    type Market = {
      liquidityA?: string;
      liquidityB?: string;
    };

    const markets: Market[] | undefined = tokenReport.markets;
    if (markets) {
      // Safely extract liquidity addresses from markets
      const liquidityAddresses: string[] = (markets ?? [])
        .flatMap((market) => [market.liquidityA, market.liquidityB])
        .filter((address): address is string => !!address);

      // Filter out topHolders that match any of the liquidity addresses
      topHolders = topHolders.filter((holder) => !liquidityAddresses.includes(holder.address));
    }
  }

  // Get config
  const rugCheckConfig = config.rug_check;
  const rugCheckLegacy = rugCheckConfig.legacy_not_allowed;

  // Set conditions
  const conditions = [
    {
      check: !rugCheckConfig.allow_mint_authority && mintAuthority !== null,
      message: "🚫 Mint authority should be null",
    },
    {
      check: !rugCheckConfig.allow_not_initialized && !isInitialized,
      message: "🚫 Token is not initialized",
    },
    {
      check: !rugCheckConfig.allow_freeze_authority && freezeAuthority !== null,
      message: "🚫 Freeze authority should be null",
    },
    {
      check: topHolders.some((holder) => holder.pct > rugCheckConfig.max_alowed_pct_topholders),
      message: "🚫 An individual top holder cannot hold more than the allowed percentage of the total supply",
    },
    {
      check: (totalLPProviders < rugCheckConfig.min_total_lp_providers) && !config.scan_options.token_search_engine.includes("brideye"),
      message: "🚫 Not enough LP Providers or not bonded.",
    },
    {
      check: marketsLength < rugCheckConfig.min_total_markets,
      message: "🚫 Not enough Markets.",
    },
    {
      check: (totalMarketLiquidity < rugCheckConfig.min_total_market_Liquidity) && (totalMarketLiquidity > rugCheckConfig.max_total_market_Liquidity),
      message: "🚫 Market Liquidity not in limits.",
    },

    {
      check: rugScore > rugCheckConfig.max_rug_score || rugScore < rugCheckConfig.min_rug_score,
      message: `🚫 Rug score to not within limits: ${rugScore}`,
    },
    {
      check: rugRisks.some((risk) => rugCheckLegacy.includes(risk.name)),
      message: "🚫 Token has legacy risks that are not allowed.",
    },
  ];

  // If tracking duplicate tokens is enabled
  if (config.rug_check.block_returning_token_names) {
    // Get duplicates based on token min and creator
    const duplicate = await selectTokenByNameAndCreator(tokenName, tokenCreator);

    // Verify if duplicate token or creator was returned
    if (duplicate.length !== 0) {
      if (config.rug_check.block_returning_token_names && duplicate.some((token) => token.name === tokenName)) {
        console.log("🚫 Token with this name was already created");
        return false;
      }
    }
  }

  if (config.scan_options.token_search_engine.includes("pumpfun")) {

    return true;
  }

  const tokenPriceInUSD = parseFloat(await getPriceThruBirdeye(tokenMint, true));

  // Check if tokenPrice is within Limits
  if (tokenPriceInUSD < config.rug_check.min_token_price || tokenPriceInUSD > config.rug_check.max_token_price) {
    console.log("🚫 Token price not within limits: ",tokenPriceInUSD);
    return false;
  }


  // Create new token record
  const newToken: NewTokenRecord = {
    time: Date.now(),
    mint: tokenMint,
    name: tokenName,
    creator: tokenCreator,
  };
  await insertNewToken(newToken).catch((err) => {
    if (config.rug_check.block_returning_token_names) {
      console.log("⛔ Unable to store new token for tracking duplicate tokens: " + err);
    }
  });

  //Validate conditions
  let shitCoin = false;
  for (const condition of conditions) {
    if (condition.check) {
      console.log(condition.message);
      shitCoin = true;
    }

  }

  return !shitCoin;
}

export async function fetchAndSaveSwapDetails(tx: string): Promise<boolean> {
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  const solMint = config.liquidity_pool.wsol_pc_mint
  let swapTransactionData: SwapEventDetailsResponse;


  try {

    const tokenMint = JSON.parse(tx).tokenMint;
    const solPriceInUSD = parseFloat(await getPriceThruBirdeye(solMint, true));
    const tokenPriceInUSD = parseFloat(await getPriceThruBirdeye(tokenMint, true));


    if (!config.swap.simulation_mode) {
      const response = await axios.post<any>(
        txUrl,
        { transactions: [tx] },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // Timeout for each request
        }
      );

      // Verify if we received tx reponse data
      if (!response.data || response.data.length === 0) {
        console.log("⛔ Could not fetch swap details: No response received from API.");
        return false;
      }

      // Safely access the event information
      const transactions: TransactionDetailsResponseArray = response.data;
      swapTransactionData = {
        programInfo: transactions[0]?.events.swap.innerSwaps[0].programInfo,
        tokenInputs: transactions[0]?.events.swap.innerSwaps[0].tokenInputs,
        tokenOutputs: transactions[0]?.events.swap.innerSwaps[0].tokenOutputs,
        fee: transactions[0]?.fee,
        slot: transactions[0]?.slot,
        timestamp: transactions[0]?.timestamp,
        description: transactions[0]?.description,
      };


    } else {

      const simulatedTransactionDetails = JSON.parse(tx);
      const solMint = config.liquidity_pool.wsol_pc_mint;

      // Calculate paid price in USDC
      const simulatedPaidUSDC = solPriceInUSD * simulatedTransactionDetails.paidSol / 1_000_000_000;

      // Fake Transaction Data for Simulation
      swapTransactionData = {
        programInfo: {
          source: "Simulation source",
          account: "Simulation account",
          programName: "Simulation programmName",
          instructionName: "SwapEvent",
        },
        tokenInputs: [{
          fromTokenAccount: "Simulation fromTokenAccount",
          toTokenAccount: "Simulation toTokenAccount",
          fromUserAccount: "Simulation fromUserAccount",
          toUserAccount: "Simulation toUserAccount",
          tokenAmount: simulatedTransactionDetails.paidSol / 1_000_000_000, // Solana paid
          mint: "So11111111111111111111111111111111111111112",
          tokenStandard: "Fungible",
        }],
        tokenOutputs: [{
          fromTokenAccount: "Simulation fromTokenAccount",
          toTokenAccount: "Simulation toTokenAccount",
          fromUserAccount: "Simulation fromUserAccount",
          toUserAccount: "Simulation toUserAccount",
          tokenAmount: simulatedPaidUSDC / tokenPriceInUSD, // Token recieved
          mint: simulatedTransactionDetails.tokenMint, // The actual mint
          tokenStandard: "Fungible",
        }],

        fee: config.swap.simulated_fee * 1_000_000_000,
        slot: 1337,
        timestamp: Date.now(),
        description: "Simulated a swap",
      }

    }


    const solPaidUsdcSum = swapTransactionData.tokenInputs[0].tokenAmount * solPriceInUSD;
    const solFeePaidUsdc = (swapTransactionData.fee / 1_000_000_000) * solPriceInUSD;
    const perTokenUsdcPrice = solPaidUsdcSum / swapTransactionData.tokenOutputs[0].tokenAmount;

    // Get token meta data
    let tokenName = "N/A";
    const tokenData: NewTokenRecord[] = await selectTokenByMint(swapTransactionData.tokenOutputs[0].mint);
    if (tokenData) {
      tokenName = tokenData[0].name;
    }

    // Add holding to db
    const newHolding: HoldingRecord = {
      Time: swapTransactionData.timestamp,
      Token: swapTransactionData.tokenOutputs[0].mint,
      TokenName: tokenName,
      Balance: swapTransactionData.tokenOutputs[0].tokenAmount,
      SolPaid: swapTransactionData.tokenInputs[0].tokenAmount,
      SolFeePaid: swapTransactionData.fee,
      SolPaidUSDC: solPaidUsdcSum,
      SolFeePaidUSDC: solFeePaidUsdc,
      PerTokenPaidUSDC: perTokenUsdcPrice,
      Slot: swapTransactionData.slot,
      Program: swapTransactionData.programInfo ? swapTransactionData.programInfo.source : "N/A",
    };

    saveToLogFile(`✅ New Holding: ${newHolding.Token} -  ${newHolding.TokenName} - ${newHolding.SolPaidUSDC.toFixed(2)}$ (Fee: ${newHolding.SolFeePaidUSDC.toFixed(4)}$) at ${newHolding.PerTokenPaidUSDC}$`);

    await insertHolding(newHolding).catch((err) => {
      console.log("⛔ Database Error: " + err);
      return false;
    });

    return true;
  } catch (error: any) {
    console.error("Error during request:", error.message);
    return false;
  }
}

export async function createSellTransaction(solMint: string, tokenMint: string, amount: string): Promise<createSellTransactionResponse> {
  const quoteUrl = process.env.JUP_HTTPS_QUOTE_URI || "";
  const swapUrl = process.env.JUP_HTTPS_SWAP_URI || "";
  const rpcUrl = process.env.HELIUS_HTTPS_URI || "";
  const myWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.PRIV_KEY_WALLET || "")));
  const connection = new Connection(rpcUrl);

  if (!config.swap.simulation_mode) {
    try {

      // Check token balance using RPC connection
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(myWallet.publicKey, {
        mint: new PublicKey(tokenMint),
      });

      //Check if token exists in wallet with non-zero balance
      const totalBalance = tokenAccounts.value.reduce((sum, account) => {
        const tokenAmount = account.account.data.parsed.info.tokenAmount.amount;
        return sum + BigInt(tokenAmount); // Use BigInt for precise calculations
      }, BigInt(0));

      // Verify returned balance
      if (totalBalance <= 0n) {
        await removeHolding(tokenMint).catch((err) => {
          console.log("⛔ Database Error: " + err);
        });
        throw new Error(`Token has 0 balance - Already sold elsewhere. Removing from tracking.`);
      }

      // Verify amount with tokenBalance
      if (totalBalance !== BigInt(amount)) {
        throw new Error(`Wallet and tracker balance mismatch. Sell manually and token will be removed during next price check.`);
      }

      // Request a quote in order to swap SOL for new token
      const quoteResponse = await axios.get<QuoteResponse>(quoteUrl, {
        params: {
          inputMint: tokenMint,
          outputMint: solMint,
          amount: amount,
          slippageBps: config.sell.slippageBps,
        },
        timeout: config.tx.get_timeout,
      });

      // Throw error if no quote was received
      if (!quoteResponse.data) {
        throw new Error("No valid quote for selling the token was received from Jupiter!");
      }


      // Serialize the quote into a swap transaction that can be submitted on chain
      const swapTransaction = await axios.post<SerializedQuoteResponse>(
        swapUrl,
        JSON.stringify({
          // quoteResponse from /quote api
          quoteResponse: quoteResponse.data,
          // user public key to be used for the swap
          userPublicKey: myWallet.publicKey.toString(),
          // auto wrap and unwrap SOL. default is true
          wrapAndUnwrapSol: true,
          //dynamicComputeUnitLimit: true, // allow dynamic compute limit instead of max 1,400,000
          dynamicSlippage: {
            // This will set an optimized slippage to ensure high success rate
            maxBps: 300, // Make sure to set a reasonable cap here to prevent MEV
          },
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: config.sell.prio_fee_max_lamports,
              priorityLevel: config.sell.prio_level,
            },
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: config.tx.get_timeout,
        }
      );

      // Throw error if no quote was received
      if (!swapTransaction.data) {
        throw new Error("No valid swap transaction was received from Jupiter!");
      }

      // deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction.data.swapTransaction, "base64");
      var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // sign the transaction
      transaction.sign([myWallet.payer]);
      let txid = ""

      // Execute the transaction
      const rawTransaction = transaction.serialize();
      txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true, // If True, This will skip transaction simulation entirely.
        maxRetries: 2,
      });

      // Return null when no tx was returned
      if (!txid) {
        throw new Error("Could not send transaction that was signed and serialized!");
      }

      // get the latest block hash
      const latestBlockHash = await connection.getLatestBlockhash();
      // Fetch the current status of a transaction signature (processed, confirmed, finalized).
      if (!config.swap.simulation_mode) {
        const conf = await connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: txid,
        });

        // Return null when an error occured when confirming the transaction
        if (conf.value.err || conf.value.err !== null) {
          throw new Error("Transaction was not successfully confirmed!");
        }
      }
      // Delete holding
      await removeHolding(tokenMint).catch((err) => {
        console.log("⛔ Database Error: " + err);
      });

      return {
        success: true,
        msg: null,
        tx: txid,
      };
    } catch (error: any) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : "Unknown error",
        tx: null,
      };
    }
  } else {
    await removeHolding(tokenMint).catch((err) => {
      console.log("⛔ Database Error: " + err);
    });

    return {
      success: true,
      msg: null,
      tx: "smulated tx",
    };
  }
}