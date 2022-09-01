import { Address, BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import { bigIntToBigDecimal } from "../utils/numbers";
import { getOrCreateProtocol } from "../entities/protocol";
import { getOrCreatePool } from "../entities/pool";
import {
  FinancialsDailySnapshot,
  PoolDailySnapshot,
  PoolHourlySnapshot,
} from "../../generated/schema";
import {
  RPL_ADDRESS,
  BIGDECIMAL_ZERO,
  BIGINT_ZERO,
  ETH_ADDRESS,
  RETH_ADDRESS,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
} from "../utils/constants";
import { getOrCreateToken } from "../entities/token";

export function updateProtocolAndPoolTvl(
  block: ethereum.Block,
  amount: BigInt,
  poolAddress: string
): void {
  const pool = getOrCreatePool(block.number, block.timestamp, poolAddress);
  const protocol = getOrCreateProtocol();

  // Pool
  pool.inputTokenBalances = [pool.inputTokenBalances[0].plus(amount)];
  // inputToken is ETH, price with ETH
  pool.totalValueLockedUSD = bigIntToBigDecimal(
    pool.inputTokenBalances[0]
  ).times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  let rewardTokens: string[] = [];
  rewardTokens.push(
    getOrCreateToken(Address.fromString(RPL_ADDRESS), block.number).name
  );
  pool.rewardTokens = rewardTokens;

  // pool.rewardTokenEmissionsAmount = [rewards_amount];
  // pool.rewardTokenEmissionsUSD = [
  //   bigIntToBigDecimal(rewards_amount).times(
  //     getOrCreateToken(Address.fromString(RPL_ADDRESS), block.number)
  //       .lastPriceUSD!
  //   ),
  // ];

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

export function updateSnapshotsTvl(
  block: ethereum.Block,
  poolAddress: string
): void {
  const pool = getOrCreatePool(block.number, block.timestamp, poolAddress);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(poolAddress),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(poolAddress),
    block
  );
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);

  // Pool Daily
  poolMetricsDailySnapshot.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsDailySnapshot.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsDailySnapshot.rewardTokenEmissionsAmount =
    pool.rewardTokenEmissionsAmount;
  poolMetricsDailySnapshot.rewardTokenEmissionsUSD =
    pool.rewardTokenEmissionsUSD;

  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsHourlySnapshot.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsHourlySnapshot.rewardTokenEmissionsAmount =
    pool.rewardTokenEmissionsAmount;
  poolMetricsHourlySnapshot.rewardTokenEmissionsUSD =
    pool.rewardTokenEmissionsUSD;

  poolMetricsHourlySnapshot.save();

  // Financials Daily
  financialMetrics.totalValueLockedUSD = pool.totalValueLockedUSD;

  financialMetrics.save();
}

export function updateTotalRevenueMetrics(
  block: ethereum.Block,
  newRewardEth: BigDecimal,
  totalShares: BigInt,
  poolAddress: string
): void {
  const pool = getOrCreatePool(block.number, block.timestamp, poolAddress);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(poolAddress),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(poolAddress),
    block
  );

  // Staking Rewards

  const total_usd = newRewardEth.times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  const stakingRewardsUSD = total_usd.minus(pool.cumulativeTotalRevenueUSD);

  // Pool
  pool.cumulativeTotalRevenueUSD =
    pool.cumulativeTotalRevenueUSD.plus(stakingRewardsUSD);
  pool.outputTokenSupply = totalShares;
  pool.outputTokenPriceUSD = getOrCreateToken(
    Address.fromString(RETH_ADDRESS),
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
  newAmount: BigDecimal,
  poolAddress: string
): void {
  const pool = getOrCreatePool(block.number, block.timestamp, poolAddress);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(poolAddress),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(poolAddress),
    block
  );

  // Staking rewards revenue is in ETH (rebased in stETH for user), price in ETH

  const newAmountUSD = newAmount.times(
    getOrCreateToken(Address.fromString(ETH_ADDRESS), block.number)
      .lastPriceUSD!
  );

  const amount = newAmountUSD.minus(pool.cumulativeProtocolSideRevenueUSD);

  // Pool
  pool.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD.plus(amount);
  pool.save();

  // Pool Daily
  poolMetricsDailySnapshot.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD =
    poolMetricsDailySnapshot.dailyProtocolSideRevenueUSD.plus(amount);
  poolMetricsDailySnapshot.save();

  // Pool Hourly
  poolMetricsHourlySnapshot.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD =
    poolMetricsHourlySnapshot.hourlyProtocolSideRevenueUSD.plus(amount);
  poolMetricsHourlySnapshot.save();

  // Protocol
  protocol.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  protocol.save();

  // Financial Daily
  financialMetrics.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;
  financialMetrics.dailyProtocolSideRevenueUSD =
    financialMetrics.dailyProtocolSideRevenueUSD.plus(amount);
  financialMetrics.save();
}

export function updateSupplySideRevenueMetrics(
  block: ethereum.Block,
  poolAddress: string
): void {
  const pool = getOrCreatePool(block.number, block.timestamp, poolAddress);
  const protocol = getOrCreateProtocol();
  const financialMetrics = getOrCreateFinancialDailyMetrics(block);
  const poolMetricsDailySnapshot = getOrCreatePoolsDailySnapshot(
    Address.fromString(poolAddress),
    block
  );
  const poolMetricsHourlySnapshot = getOrCreatePoolsHourlySnapshot(
    Address.fromString(poolAddress),
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
    financialMetrics.protocol = RETH_ADDRESS;

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
    poolMetrics.pool = getOrCreatePool(
      block.number,
      block.timestamp,
      poolAddress.toString()
    ).id;

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
    poolMetrics.pool = getOrCreatePool(
      block.number,
      block.timestamp,
      poolAddress.toString()
    ).id;

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
