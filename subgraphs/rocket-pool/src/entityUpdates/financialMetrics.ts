import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import { bigIntToBigDecimal } from "../utils/numbers";
import { getOrCreateProtocol } from "../entities/protocol";
import { getOrCreatePool } from "../entities/pool";
import {
  FinancialsDailySnapshot,
  PoolDailySnapshot,
  PoolHourlySnapshot,
} from "../../generated/schema";
import {
  BIGDECIMAL_ZERO,
  BIGINT_ZERO,
  ETH_ADDRESS,
  RETH_ADDRESS,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  RPL_ADDRESS,
  BIGDECIMAL_HALF,
} from "../utils/constants";
import { getOrCreateToken } from "../entities/token";
import { getOrCreateMinipool } from "../entities/Minipool";

const PROTOCOL_ID = RETH_ADDRESS;

export function updateMinipoolTvlandRevenue(
  block: ethereum.Block,
  stakingAmount: BigInt,
  slashingAmount: BigInt,
  totalRewardEth: BigInt,
  miniPoolAddress: string
): void {
  const Minipool = getOrCreateMinipool(
    block.number,
    block.timestamp,
    miniPoolAddress
  );
  const pool = getOrCreatePool(block.number, block.timestamp);
  Minipool.inputTokenBalances = [
    Minipool.inputTokenBalances[0].plus(stakingAmount),
  ];
  Minipool.totalValueLockedUSD = bigIntToBigDecimal(
    Minipool.inputTokenBalances[0]
  ).times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  Minipool.slashAmount = Minipool.slashAmount.plus(slashingAmount);

  if (totalRewardEth > BIGINT_ZERO) {
    log.warning("[getOrCreatePool] TotalRewardEth nonzero, updating revenue", [
      totalRewardEth.toString(),
    ]);
    let ratio = Minipool.inputTokenBalances[0].div(pool.inputTokenBalances[0]);
    let miniPoolRewardEth = ratio.times(totalRewardEth);
    let miniPoolRewardUSD = bigIntToBigDecimal(miniPoolRewardEth).times(
      getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
        .lastPriceUSD!
    );
    Minipool.cumulativeTotalRevenueUSD = miniPoolRewardUSD;
    Minipool.cumulativeProtocolSideRevenueUSD = miniPoolRewardUSD.times(
      BIGDECIMAL_HALF.minus(BIGDECIMAL_HALF.times(Minipool.comissionRate))
    );
  }
  Minipool.save();
}

export function updateProtocolAndPoolTvl(
  block: ethereum.Block,
  amount: BigInt,
  rewardAmount: BigInt
): void {
  const pool = getOrCreatePool(block.number, block.timestamp);
  const protocol = getOrCreateProtocol();

  let rewardTokens = [
    getOrCreateToken(Address.fromString(RPL_ADDRESS), block.number).id,
  ];

  pool.rewardTokens = rewardTokens;

  // Pool
  let inputTokenBalances: BigInt[] = [];
  inputTokenBalances.push(pool.inputTokenBalances[0].plus(amount));
  inputTokenBalances.push(pool.inputTokenBalances[1].plus(rewardAmount));

  pool.inputTokenBalances = inputTokenBalances;

  // inputToken is ETH, price with ETH

  let ethTVLUSD = bigIntToBigDecimal(inputTokenBalances[0]).times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  let rplTVLUSD = bigIntToBigDecimal(inputTokenBalances[1]).times(
    getOrCreateToken(Address.fromString(RPL_ADDRESS), block.number)
      .lastPriceUSD!
  );

  let totalValueLockedUSD = ethTVLUSD.plus(rplTVLUSD);
  pool.totalValueLockedUSD = totalValueLockedUSD;

  pool.save();

  // Pool Daily and Hourly
  // updateSnapshotsTvl(event.block) is called separately when protocol and supply side revenue
  // metrics are being calculated to consolidate respective revenue metrics into same snapshots

  // Protocol
  protocol.totalValueLockedUSD = pool.totalValueLockedUSD;
  protocol.save();

  // Financials Daily
  // updateSnapshotsTvl(event.block) is called separately when protocol and supply side revenue
  // metrics are being calculated to consolidate respective revenue metrics into same snapshots
}

export function updateSnapshotsTvl(block: ethereum.Block): void {
  const pool = getOrCreatePool(block.number, block.timestamp);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);

  // Pool Daily
  poolMetricsDailySnapshot.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsDailySnapshot.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsHourlySnapshot.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsHourlySnapshot.save();

  // Financials Daily
  financialMetrics.totalValueLockedUSD = pool.totalValueLockedUSD;
  financialMetrics.save();
}

export function updateTotalRevenueMetrics(
  block: ethereum.Block,
  stakingRewards: BigInt,
  totalShares: BigInt // of rETH
): void {
  const pool = getOrCreatePool(block.number, block.timestamp);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );

  // Staking Rewards

  const stakingRewardsUSD = bigIntToBigDecimal(stakingRewards).times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  // Pool
  pool.cumulativeTotalRevenueUSD =
    pool.cumulativeTotalRevenueUSD.plus(stakingRewardsUSD);
  pool.outputTokenSupply = totalShares;
  pool.outputTokenPriceUSD = getOrCreateToken(
    Address.fromString(PROTOCOL_ID),
    block.number
  ).lastPriceUSD;
  pool.save();

  // Pool Daily
  poolMetricsDailySnapshot.cumulativeTotalRevenueUSD =
    pool.cumulativeTotalRevenueUSD;
  poolMetricsDailySnapshot.dailyTotalRevenueUSD =
    poolMetricsDailySnapshot.dailyTotalRevenueUSD.plus(stakingRewardsUSD);
  poolMetricsDailySnapshot.outputTokenSupply = pool.outputTokenSupply;
  poolMetricsDailySnapshot.outputTokenPriceUSD = pool.outputTokenPriceUSD;
  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.cumulativeTotalRevenueUSD =
    pool.cumulativeTotalRevenueUSD;
  poolMetricsHourlySnapshot.hourlyTotalRevenueUSD =
    poolMetricsHourlySnapshot.hourlyTotalRevenueUSD.plus(stakingRewardsUSD);
  poolMetricsHourlySnapshot.outputTokenSupply = pool.outputTokenSupply;
  poolMetricsHourlySnapshot.outputTokenPriceUSD = pool.outputTokenPriceUSD;
  poolMetricsHourlySnapshot.save();

  // Protocol
  protocol.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  protocol.save();

  // Financials Daily
  financialMetrics.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  financialMetrics.dailyTotalRevenueUSD =
    poolMetricsDailySnapshot.dailyTotalRevenueUSD;
  financialMetrics.save();
}

export function updateProtocolSideRevenueMetrics(
  block: ethereum.Block,
  amount: BigInt
): void {
  const pool = getOrCreatePool(block.number, block.timestamp);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );

  // Staking rewards revenue is in ETH (rebased in stETH for user), price in ETH
  const amountUSD = bigIntToBigDecimal(amount).times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  // Pool
  pool.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD.plus(amountUSD);
  pool.save();

  // Pool Daily
  poolMetricsDailySnapshot.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD =
    poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD.plus(amountUSD);
  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD =
    poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD.plus(amountUSD);
  poolMetricsHourlySnapshot.save();

  // Protocol
  protocol.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  protocol.save();

  // Financial Daily
  financialMetrics.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  financialMetrics.dailyProtocolSideRevenueUSD =
    financialMetrics.dailyProtocolSideRevenueUSD.plus(amountUSD);
  financialMetrics.save();
}

export function updateSupplySideRevenueMetrics(block: ethereum.Block): void {
  const pool = getOrCreatePool(block.number, block.timestamp);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(PROTOCOL_ID),
    block
  );

  // Pool
  pool.cumulativeSupplySideRevenueUSD =
    pool.cumulativeTotalRevenueUSD <= pool.cumulativeProtocolSideRevenueUSD
      ? BIGDECIMAL_ZERO
      : pool.cumulativeTotalRevenueUSD.minus(
          pool.cumulativeProtocolSideRevenueUSD
        );
  pool.save();

  // Pool Daily
  poolMetricsDailySnapshot.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsDailySnapshot.dailySupplySideRevenueUSD =
    poolMetricsDailySnapshot.dailyTotalRevenueUSD <=
    poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD
      ? BIGDECIMAL_ZERO
      : poolMetricsDailySnapshot.dailyTotalRevenueUSD.minus(
          poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD
        );
  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsHourlySnapshot.hourlySupplySideRevenueUSD =
    poolMetricsHourlySnapshot.hourlyTotalRevenueUSD <=
    poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD
      ? BIGDECIMAL_ZERO
      : poolMetricsHourlySnapshot.hourlyTotalRevenueUSD.minus(
          poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD
        );
  poolMetricsHourlySnapshot.save();

  // Protocol
  protocol.cumulativeSupplySideRevenueUSD = pool.cumulativeSupplySideRevenueUSD;
  protocol.save();

  // Financial Daily
  financialMetrics.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  financialMetrics.dailySupplySideRevenueUSD =
    financialMetrics.dailyTotalRevenueUSD <=
    financialMetrics.dailyProtocolSideRevenueUSD
      ? BIGDECIMAL_ZERO
      : financialMetrics.dailyTotalRevenueUSD.minus(
          financialMetrics.dailyProtocolSideRevenueUSD
        );
  financialMetrics.save();
}

export function getOrCreateFinancialDailyMetrics(
  block: ethereum.Block
): FinancialsDailySnapshot {
  let dayId: string = (block.timestamp.toI64() / SECONDS_PER_DAY).toString();
  let financialMetrics = FinancialsDailySnapshot.load(dayId);

  if (!financialMetrics) {
    financialMetrics = new FinancialsDailySnapshot(dayId);
    financialMetrics.protocol = PROTOCOL_ID;

    financialMetrics.totalValueLockedUSD = BIGDECIMAL_ZERO;
    financialMetrics.dailyTotalRevenueUSD = BIGDECIMAL_ZERO;
    financialMetrics.cumulativeTotalRevenueUSD = BIGDECIMAL_ZERO;
    financialMetrics.dailyProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
    financialMetrics.cumulativeProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
    financialMetrics.dailySupplySideRevenueUSD = BIGDECIMAL_ZERO;
    financialMetrics.cumulativeSupplySideRevenueUSD = BIGDECIMAL_ZERO;
  }

  // Set block number and timestamp to the latest for snapshots
  financialMetrics.blockNumber = block.number;
  financialMetrics.timestamp = block.timestamp;

  financialMetrics.save();

  return financialMetrics;
}

export function getOrCreatePoolsDailySnapshot(
  poolAddress: Address,
  block: ethereum.Block
): PoolDailySnapshot {
  let dayId: string = (block.timestamp.toI64() / SECONDS_PER_DAY).toString();
  let poolMetrics = PoolDailySnapshot.load(dayId);

  if (!poolMetrics) {
    poolMetrics = new PoolDailySnapshot(dayId);
    poolMetrics.protocol = getOrCreateProtocol().id;
    poolMetrics.pool = getOrCreatePool(block.number, block.timestamp).id;

    poolMetrics.totalValueLockedUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeTotalRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeSupplySideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.dailyTotalRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.dailySupplySideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.dailyProtocolSideRevenueUSD = BIGDECIMAL_ZERO;

    poolMetrics.inputTokenBalances = [BIGINT_ZERO];
    poolMetrics.outputTokenSupply = BIGINT_ZERO;
    poolMetrics.outputTokenPriceUSD = BIGDECIMAL_ZERO;
  }

  // Set block number and timestamp to the latest for snapshots
  poolMetrics.blockNumber = block.number;
  poolMetrics.timestamp = block.timestamp;

  poolMetrics.save();

  return poolMetrics;
}

export function getOrCreatePoolsHourlySnapshot(
  poolAddress: Address,
  block: ethereum.Block
): PoolHourlySnapshot {
  let hourId: string = (block.timestamp.toI64() / SECONDS_PER_HOUR).toString();
  let poolMetrics = PoolHourlySnapshot.load(hourId);

  if (!poolMetrics) {
    poolMetrics = new PoolHourlySnapshot(hourId);
    poolMetrics.protocol = getOrCreateProtocol().id;
    poolMetrics.pool = getOrCreatePool(block.number, block.timestamp).id;

    poolMetrics.totalValueLockedUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeTotalRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeSupplySideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.cumulativeProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.hourlyTotalRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.hourlySupplySideRevenueUSD = BIGDECIMAL_ZERO;
    poolMetrics.hourlyProtocolSideRevenueUSD = BIGDECIMAL_ZERO;

    poolMetrics.inputTokenBalances = [BIGINT_ZERO];
    poolMetrics.outputTokenSupply = BIGINT_ZERO;
    poolMetrics.outputTokenPriceUSD = BIGDECIMAL_ZERO;
  }

  // Set block number and timestamp to the latest for snapshots
  poolMetrics.blockNumber = block.number;
  poolMetrics.timestamp = block.timestamp;

  poolMetrics.save();

  return poolMetrics;
}
