/** 
*  * Detailed Explanations (To be continued)
*  
* -------------------
* prio_level:
* -------------------
* priorityLevel: Allows you to set a custom priority level for the fee. If priorityLevel is not specified, 
* the API will use the Medium (50th percentile) level. The levels and their corresponding percentiles are:
*     Min:        0th percentile
*     Low:        25th percentile
*     Medium:     50th percentile
*     High:       75th percentile
*     VeryHigh:   95th percentile
*     UnsafeMax:  100th percentile (use with caution).
* -------------------
* legacy_not_allowed:
* -------------------
* Sorted from high risk to lower risk - however all of them are still risky!
* 
* 1. Freeze Authority Still Enabled: 
* This means that the developers or issuer of the coin have the ability to freeze transactions or revert them. 
* This can be a sign of a lack of decentralization and can undermine your confidence in the stability 
* and security of the coin.
* 
* 2. Single Holder Ownership: 
* If a single wallet holder owns a large portion of the coins, this person could manipulate the market by 
* selling off or withholding large amounts. This is risky for you as the value of your investment could 
* heavily depend on the actions of one person.
* 
* 3. High Holder Concentration: 
* Similar to single holder ownership, but here, a few holders own a large percentage of the coins. This increases 
* the risk of market manipulations and price fluctuations if these major holders suddenly decide to sell.
* 
* 4. Large Amount of LP Unlocked: 
* LP stands for Liquidity Provider. If a large amount of the liquidity pool tokens are unlocked, 
* providers could withdraw them at any time, which could lead to a sudden loss of liquidity and a potential price drop.
* 
* 5. Low Liquidity:
* Low liquidity means there are not many coins available for buying or selling. This can lead to extreme 
* price changes even with small buy or sell orders. It's risky because you might not be able to sell your 
* coins without significantly impacting the price.
* 
* 6. Copycat Token: 
* A token that is simply a copy of another existing token, often without any innovative features or improvements. 
* This can indicate a lack of seriousness or potential for long-term growth.
* 
* 7. Low Amount of LP Providers: 
* Having few liquidity providers means the liquidity of the token depends on a few sources. 
* This can be risky, as if these providers decide to withdraw their funds, it could destabilize the market.
**/

export const config = {
  liquidity_pool: {
    radiyum_program_id: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    wsol_pc_mint: "So11111111111111111111111111111111111111112",
  },
  programs: {
    pump_raydium_migration: "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
  },
  settings: {
    parse_signature: {
      verbose_logging: false,
      initial_delay: 3000,
      request_timeout: 10000,
      maxRetries: 10,
    },
  },
    tx: {
      fetch_tx_max_retries: 10,
      fetch_tx_initial_delay: 3000, // Initial delay before fetching LP creation transaction details (3 seconds)
      swap_tx_initial_delay: 1000, // Initial delay before first buy (1 second)
      get_timeout: 10000, // Timeout for API requests
      concurrent_transactions: 5, // Number of simultaneous transactions
      retry_delay: 500, // Delay between retries (0.5 seconds)
    },
    swap: {
      verbose_log: false,
      simulation_mode: true,
      simulated_fee: 0,// In Solana
      prio_fee_max_lamports: 1000000, // 0.001 SOL
      prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
      amount: "200000000", //100000000 = 0.2 SOL
      slippageBps: "1000", // 100 = 1%
      db_name_tracker_holdings: "src/tracker/holdings.db", // Sqlite Database location
      token_not_tradable_400_error_retries: 5, // How many times should the bot try to get a quote if the token is not tradable yet
      token_not_tradable_400_error_delay: 2000, // How many seconds should the bot wait before retrying to get a quote again
      max_token_holdings: 5, // Maximum number of tokens to hold (Only for Birdeye MODE)
    
    },
    scan_options: {
      // Options token_search_engine: 
      // "brideye": This will provide unbonded tokens in most cases
      // "helius: Token search engine via Helius RPC
      token_search_engine: "helius",
      price_ratelimit_ms: 250, // Milliseconds between API Price calls for price checking
      max_token_fetch: 3, // Maximum number of tokens to fetch from BirdEye
      min_age_of_token: 0, // In seconds after listing when using BirdEye
      tsproc_ratelimit_ms: 1000, // Milliseconds between processTransaction calls
    },
    sell: {
      verbose_log: false,
      prio_fee_max_lamports: 1000000, // 0.001 SOL
      prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
      slippageBps: "1000", // 10%
      auto_sell: true, // If set to true, stop loss and take profit triggers automatically when set.
      stop_loss_percent: 20, // Set -1 to disable
      take_profit_percent: 20, // Set -1 to disable
      track_public_wallet: "", // If set an additional log line will be shown with a link to track your wallet
    },
    rug_check: {
      verbose_log: false,
      // Dangerous
      allow_mint_authority: false, // The mint authority is the address that has permission to mint (create) new tokens. Strongly Advised to set to false.
      allow_not_initialized: false, // This indicates whether the token account is properly set up on the blockchain. Strongly Advised to set to false
      allow_freeze_authority: false, // The freeze authority is the address that can freeze token transfers, effectively locking up funds. Strongly Advised to set to false
      // Critical
      block_returning_token_names: true,
      allow_insider_topholders: false, // Allow insider accounts to be part of the topholders
      max_alowed_pct_topholders: 25, // Max allowed percentage an individual topholder might hold
      exclude_lp_from_topholders: true, // If true, Liquidity Pools will not be seen as top holders
      // Warning
      min_total_markets: 1,
      min_total_lp_providers: 1,
      min_total_market_Liquidity: 20000,
      max_total_market_Liquidity: 1000000,
      // Misc
      ignore_pump_fun: false,
      max_rug_score: 2000, // Set to 0 to ignore
      min_rug_score: 0,
      min_token_price: 0.000001, // Dollar
      max_token_price: 0.002, // Dollar
      legacy_not_allowed: [
        "Freeze Authority still enabled",
        "Single holder ownership",
        "High holder concentration",
        //"Large Amount of LP Unlocked",
        //"Low Liquidity",                
        //"Copycat token",              
        //"Low amount of LP Providers", 
      ],
    },
  };
