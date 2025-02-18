import { config } from "./../config"; // Configuration parameters for our bot
import axios from "axios";
import * as sqlite3 from "sqlite3";
import dotenv from "dotenv";
import { open } from "sqlite";
import { createTableHoldings } from "./db";
import { createSellTransactionResponse, HoldingRecord, LastPriceDexReponse } from "../types";
import { DateTime } from "luxon";
import { createSellTransaction } from "../transactions";
import { getPriceThruBirdeye } from "../tokenutility";
import * as fs from "fs";

// Load environment variables from the .env file
dotenv.config();

// Create Action Log constant
const actionsLogs: string[] = [];
const logFilePath = "./src/logs/tracker.log";


// Simulation metrics
let commulativePnL = 0;
let commulativePnlUnrealized = 0;
async function main() {
  const priceUrl = process.env.JUP_HTTPS_PRICE_URI || "";
  const dexPriceUrl = process.env.DEX_HTTPS_LATEST_TOKENS || "";
  const solMint = config.liquidity_pool.wsol_pc_mint;
  while (true) {
    commulativePnlUnrealized = 0;

    // Connect to database and create if not exists
    const db = await open({
      filename: config.swap.db_name_tracker_holdings,
      driver: sqlite3.Database,
    });

    // Create Table if not exists
    const holdingsTableExist = await createTableHoldings(db);
    if (!holdingsTableExist) {
      console.log("Holdings table not present.");
      // Close the database connection when done
      await db.close();
    }

    // Proceed with tracker
    if (holdingsTableExist) {
      // Create const for holdings and action logs.
      const holdingLogs: string[] = [];

      // Create regional functions to push holdings and logs to const
      const saveLogTo = (logsArray: string[], ...args: unknown[]): void => {
        const message = args.map((arg) => String(arg)).join(" ");
        logsArray.push(message);
      };

      const saveToLogFile = (message: string): void => {
        fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`, "utf8");
      };


      // Get all our current holdings
      const holdings = await db.all("SELECT * FROM holdings");
      if (holdings.length !== 0) {
        // Get all token ids
        const tokenMints = holdings.map((holding) => holding.Token).join(",");

        const fetchPrices = async (tokenMints: string): Promise<{ [key: string]: string }> => {
          const prices: { [key: string]: string } = {};

          // Zerlegen der tokenMints-String in ein Array und Durchlaufen jedes Elements
          const mintsArray = tokenMints.split(',');
          for (const tokenMint of mintsArray) {
            await new Promise(resolve => setTimeout(resolve, 1050));
            const price = await getPriceThruBirdeye(tokenMint, false);
            prices[tokenMint] = price;
          }

          return prices;
        };
        const tokenCurrentPriceArray = await fetchPrices(tokenMints);

        const prices = Object.values(tokenCurrentPriceArray);
        let startOver = false;
        for (const price of prices) {
          if (price == "") {
            startOver = true;
          }
        }
        if (startOver)
          continue;

        // Loop trough all our current holdings
        await Promise.all(
          holdings.map(async (row) => {
            const holding: HoldingRecord = row;
            const token = holding.Token;
            const tokenName = holding.TokenName === "N/A" ? token : holding.TokenName;
            const tokenTime = holding.Time;
            const tokenBalance = holding.Balance;
            const tokenSolPaid = holding.SolPaid;
            const tokenSolFeePaid = holding.SolFeePaid;
            const tokenSolPaidUSDC = holding.SolPaidUSDC;
            const tokenSolFeePaidUSDC = holding.SolFeePaidUSDC;
            const tokenPerTokenPaidUSDC = holding.PerTokenPaidUSDC;
            const tokenSlot = holding.Slot;
            const tokenProgram = holding.Program;

            // Conver Trade Time
            const centralEuropenTime = DateTime.fromMillis(tokenTime).toLocal();
            const hrTradeTime = centralEuropenTime.toFormat("HH:mm:ss");

            const tokenCurrentPrice = parseFloat(tokenCurrentPriceArray[token]);
            // Calculate PnL and profit/loss
            const unrealizedPnLUSDC = (tokenCurrentPrice - tokenPerTokenPaidUSDC) * tokenBalance;
            const unrealizedPnLPercentage = (unrealizedPnLUSDC / (tokenPerTokenPaidUSDC * tokenBalance)) * 100;
            const iconPnl = unrealizedPnLUSDC > 0 ? "🟢" : "🔴";

            commulativePnlUnrealized += unrealizedPnLUSDC;

            // Check SL/TP
            if (config.sell.auto_sell && config.sell.auto_sell === true) {
              const amountIn = tokenBalance.toString().replace(".", "");

              // Sell via Take Profit
              if (unrealizedPnLPercentage >= config.sell.take_profit_percent && config.sell.take_profit_percent !== -1) {
                commulativePnL += unrealizedPnLUSDC - tokenSolFeePaidUSDC;

                try {
                  const result: createSellTransactionResponse = await createSellTransaction(config.liquidity_pool.wsol_pc_mint, token, amountIn);
                  const txErrorMsg = result.msg;
                  const txSuccess = result.success;
                  const tXtransaction = result.tx;
                  // Add success to log output
                  if (txSuccess) {
                    saveLogTo(actionsLogs, `✅🟢 ${hrTradeTime}: Took profit for ${tokenName} at ${unrealizedPnLPercentage.toFixed(2)}%\nTx: ${tXtransaction}`);
                    saveToLogFile(`🟢 Took profit for ${token} - ${tokenName} at ${tokenCurrentPrice} -  ${unrealizedPnLUSDC.toFixed(2)}$ ${unrealizedPnLPercentage.toFixed(2)}%`)
                  } else {
                    saveLogTo(actionsLogs, `⚠️ ERROR when taking profit for ${tokenName}: ${txErrorMsg}`);
                  }
                } catch (error: any) {
                  saveLogTo(actionsLogs, `⚠️  ERROR when taking profit for ${tokenName}: ${error.message}`);
                }

              }

              // Sell via Stop Loss
              if (unrealizedPnLPercentage <= -config.sell.stop_loss_percent && config.sell.stop_loss_percent !== -1) {
                commulativePnL += unrealizedPnLUSDC - tokenSolFeePaidUSDC;

                try {
                  const result: createSellTransactionResponse = await createSellTransaction(config.liquidity_pool.wsol_pc_mint, token, amountIn);
                  const txErrorMsg = result.msg;
                  const txSuccess = result.success;
                  const tXtransaction = result.tx;
                  // Add success to log output
                  if (txSuccess) {
                    saveLogTo(actionsLogs, `✅🔴 ${hrTradeTime}: Triggered Stop Loss for ${tokenName} at ${unrealizedPnLPercentage.toFixed(2)}%  \nTx: ${tXtransaction}`);
                    saveToLogFile(`🔴 Triggered Stop Loss for ${token} - ${tokenName} at ${tokenCurrentPrice} -  ${unrealizedPnLUSDC.toFixed(2)}$ ${unrealizedPnLPercentage.toFixed(2)}%`)
                  } else {
                    saveLogTo(actionsLogs, `⚠️ ERROR when triggering Stop Loss for ${tokenName}: ${txErrorMsg}`);
                  }
                } catch (error: any) {
                  saveLogTo(actionsLogs, `\n⚠️ ERROR when triggering Stop Loss for ${tokenName}: ${error.message}: \n`);
                }

              }
            }

            // Get the current pricek
            saveLogTo(
              holdingLogs,
              `${hrTradeTime}: Buy $${tokenSolPaidUSDC.toFixed(2)} | ${iconPnl} Unrealized PnL: $${unrealizedPnLUSDC.toFixed(
                2
              )} (${unrealizedPnLPercentage.toFixed(2)}%) | ${tokenBalance} ${tokenName} | ${tokenCurrentPrice.toFixed(8)} | ${token}`
            );

          })
        );
      }

      // Output Current Holdings
      console.clear();

      console.log(`📈 Current Holdings  ✅ ${new Date().toISOString()}`);
      console.log("===========================================================================================================================================");
      if (holdings.length === 0) console.log("No token holdings yet as of", new Date().toISOString());
      console.log(holdingLogs.join("\n"));
      // Simulation Metrics Output
      if (config.swap.simulation_mode) {
        console.log("\n🚨 Simulation Mode is enabled. No real transactions will be made.");
      } else {
        console.log("\n🚨 Tracker");
      }
      console.log("===========================================================================================================================================");
      console.log(`Overall unrealized PNL: ${commulativePnlUnrealized.toFixed(2)} $`);
      console.log(`Overall realized PNL:   ${commulativePnL.toFixed(2)} $`);

      // Output Action Logs
      if (config.sell.verbose_log) {
        console.log("\n\n📜 Action Logs");
        console.log("===========================================================================================================================================");
        console.log("Last Update: ", new Date().toISOString());
        console.log(actionsLogs.join("\n"));
      }
      // Output wallet tracking if set in config
      if (config.sell.track_public_wallet) {
        console.log("\nCheck your wallet: https://gmgn.ai/sol/address/" + config.sell.track_public_wallet);
      }

      await db.close();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch((err) => {
  console.error(err);
});
