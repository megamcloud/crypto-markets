import { strict as assert } from 'assert';
import axios from 'axios';
import { normalizePair } from 'crypto-pair';
import { Market, MarketType } from '../pojo/market';
import { calcPrecision } from '../utils';

// doc: https://github.com/WhaleEx/API

const RESTFUL_API_DOMAIN = 'api.whaleex.com';

interface WhaleExPairInfo {
  name: string;
  baseCurrency: string;
  basePrecision: number;
  quoteCurrency: string;
  quotePrecision: number;
  precision: number;
  enable: boolean;
  status: 'ON' | 'OFF';
  baseContract: string;
  quoteContract: string;
  tickSize: string;
  lotSize: string;
  minQty: string;
  minNotional: string;
}

async function populateQuoteContract(pairInfos: WhaleExPairInfo[]): Promise<void> {
  const response = await axios.get(`https://${RESTFUL_API_DOMAIN}/BUSINESS/api/public/currency`);
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');

  type CurrencyInfo = {
    shortName: string;
    token: string;
    contract: string;
    quotable: boolean;
    visible: boolean;
    status: string;
  };
  const arr = (response.data as Array<CurrencyInfo>).filter(
    (x) => x.quotable && x.visible && x.status === 'ON',
  );

  const map = new Map<string, string>();
  arr.forEach((x) => {
    // assert.equal(x.shortName, x.token); // e.g., BTC, EBTC
    map.set(x.shortName, x.contract);
  });
  pairInfos.forEach((pairInfo) => {
    pairInfo.quoteContract = map.get(pairInfo.quoteCurrency)!; // eslint-disable-line no-param-reassign
  });
}

export async function fetchSpotMarkets(): Promise<readonly Market[]> {
  const response = await axios.get(`https://${RESTFUL_API_DOMAIN}/BUSINESS/api/public/symbol`);
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');

  const arr = response.data as Array<WhaleExPairInfo>;

  await populateQuoteContract(arr);

  const markets: Market[] = arr.map((pairInfo) => {
    const baseSymbol = pairInfo.baseCurrency === 'KEY' ? 'MYKEY' : pairInfo.baseCurrency;
    const quoteSymbol = pairInfo.quoteCurrency;

    const market: Market = {
      exchange: 'WhaleEx',
      type: 'Spot',
      id: pairInfo.name,
      pair: `${baseSymbol}_${quoteSymbol}`,
      base: baseSymbol,
      quote: quoteSymbol,
      baseId: baseSymbol,
      quoteId: quoteSymbol,
      active: pairInfo.enable && pairInfo.status === 'ON',
      // see https://whaleex.zendesk.com/hc/zh-cn/articles/360015324891-%E4%BA%A4%E6%98%93%E6%89%8B%E7%BB%AD%E8%B4%B9
      fees: {
        maker: 0.001,
        taker: 0.001,
      },
      precision: {
        price: calcPrecision(pairInfo.tickSize),
        base: pairInfo.basePrecision,
        quote: pairInfo.quotePrecision,
      },
      minQuantity: {
        base: parseFloat(pairInfo.minQty),
        quote: parseFloat(pairInfo.minNotional),
      },
      info: pairInfo,
    };
    assert.equal(market.pair, normalizePair(market.id, 'WhaleEx'));

    // delete volatile fields
    delete market.info.baseVolume;
    delete market.info.high;
    delete market.info.low;
    delete market.info.lastPrice;
    delete market.info.priceChangePercent;
    delete market.info.quoteVolume;
    delete market.info.updatedTime;
    delete market.info.weight;
    delete market.info.weightChange;
    delete market.info.weightVolume;

    return market;
  });

  return markets.sort((x, y) => x.pair.localeCompare(y.pair));
}

export async function fetchMarkets(marketType?: MarketType): Promise<readonly Market[]> {
  if (marketType) {
    return marketType === 'Spot' ? fetchSpotMarkets() : [];
  }
  return fetchSpotMarkets();
}
