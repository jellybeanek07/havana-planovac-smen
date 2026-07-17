// Vercel serverless funkce – stáhne počasí na serveru a pošle ho tvé stránce.
//
// ULOŽIT DO REPOZITÁŘE PŘESNĚ SEM:  api/weather.js
// (složka "api" v kořeni repozitáře, v ní soubor "weather.js")
//
// Ověření:  https://havana-planovac-smen.vercel.app/api/weather
//
// Proč to existuje:
//   Když Open-Meteo vrátí chybu (např. "service is overloaded"), nepřipojí
//   k ní CORS hlavičku. Prohlížeč takovou odpověď zahodí a fetch() spadne
//   na "Failed to fetch". Na serveru žádné CORS neplatí, takže tady chybu
//   normálně uvidíme – a můžeme zkusit jiný zdroj.
//
// Zdroje:  1) Open-Meteo (3 pokusy)  2) MET Norway / yr.no

const LAT = 49.4828;   // Suchý u Boskovic
const LON = 16.7625;

// ─── Zdroj 1: Open-Meteo ────────────────────────────────────────────────
async function zkusOpenMeteo() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + LAT + '&longitude=' + LON
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m'
    + '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'
    + '&timezone=auto&forecast_days=16';

  const r = await fetch(url);
  const d = await r.json().catch(function () { return null; });

  // Open-Meteo hlásí chybu buď HTTP kódem, nebo polem "error" v těle
  if (!r.ok || !d || d.error) {
    throw new Error((d && d.reason) || ('HTTP ' + r.status));
  }

  // Hodinová data rozdělíme podle dnů
  const hodinyPodleDne = {};
  if (d.hourly && d.hourly.time) {
    d.hourly.time.forEach(function (t, i) {
      const datum = t.slice(0, 10);
      if (!hodinyPodleDne[datum]) hodinyPodleDne[datum] = [];
      hodinyPodleDne[datum].push({
        cas: t.slice(11, 16),
        temp: d.hourly.temperature_2m[i],
        code: d.hourly.weather_code[i],
        rain: d.hourly.precipitation[i],
        rainProb: d.hourly.precipitation_probability
          ? d.hourly.precipitation_probability[i] : null
      });
    });
  }

  return {
    source: 'Open-Meteo.com',
    current: {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      humidity: d.current.relative_humidity_2m,
      code: d.current.weather_code,
      wind: d.current.wind_speed_10m,
      windDir: d.current.wind_direction_10m
    },
    daily: d.daily.time.map(function (t, i) {
      return {
        date: t,
        code: d.daily.weather_code[i],
        max: d.daily.temperature_2m_max[i],
        min: d.daily.temperature_2m_min[i],
        rain: d.daily.precipitation_sum[i],
        wind: d.daily.wind_speed_10m_max[i],
        hodiny: hodinyPodleDne[t] || []
      };
    })
  };
}

// ─── Zdroj 2: MET Norway (yr.no) ────────────────────────────────────────
// Převod jejich symbolů na stejné WMO kódy, jaké používá Open-Meteo,
// aby stránka nemusela rozlišovat, odkud data přišla.
const SYMBOL_NA_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrainshowers: 80, rainshowers: 80, heavyrainshowers: 82,
  lightrain: 51, rain: 63, heavyrain: 65,
  lightsleet: 66, sleet: 66, heavysleet: 67,
  lightsleetshowers: 66, sleetshowers: 66, heavysleetshowers: 67,
  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 96,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95,
  heavyrainshowersandthunder: 96,
  lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 96,
  lightsleetandthunder: 95, sleetandthunder: 95, heavysleetandthunder: 96
};

function symbolNaWmo(symbol) {
  if (!symbol) return 3;
  // Odstraníme přípony _day / _night / _polartwilight
  const zaklad = String(symbol).replace(/_(day|night|polartwilight)$/, '');
  return SYMBOL_NA_WMO[zaklad] != null ? SYMBOL_NA_WMO[zaklad] : 3;
}

async function zkusMetNorway() {
  // MET Norway vyžaduje User-Agent identifikující aplikaci – jinak vrátí 403.
  const r = await fetch(
    'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + LAT + '&lon=' + LON,
    { headers: { 'User-Agent': 'havana-planovac-smen/1.0 github.com/jellybeanek07' } }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();

  const rada = d.properties.timeseries;
  const ted = rada[0];
  const detail = ted.data.instant.details;
  const symbolTed = (ted.data.next_1_hours && ted.data.next_1_hours.summary.symbol_code)
    || (ted.data.next_6_hours && ted.data.next_6_hours.summary.symbol_code);

  // Poskládáme denní souhrny z hodinových záznamů
  const dny = {};
  rada.forEach(function (bod) {
    const datum = bod.time.slice(0, 10);
    const det = bod.data.instant.details;
    if (!dny[datum]) {
      dny[datum] = { date: datum, max: -99, min: 99, rain: 0, wind: 0, symboly: {}, hodiny: [] };
    }
    const den = dny[datum];
    if (det.air_temperature != null) {
      if (det.air_temperature > den.max) den.max = det.air_temperature;
      if (det.air_temperature < den.min) den.min = det.air_temperature;
    }
    if (det.wind_speed != null) {
      // m/s → km/h
      const kmh = det.wind_speed * 3.6;
      if (kmh > den.wind) den.wind = kmh;
    }
    const h1 = bod.data.next_1_hours;
    if (h1 && h1.details && h1.details.precipitation_amount != null) {
      den.rain += h1.details.precipitation_amount;
    }
    // Symbol kolem poledne bereme jako reprezentativní pro celý den
    const hodina = parseInt(bod.time.slice(11, 13), 10);
    if (hodina >= 11 && hodina <= 14 && h1 && h1.summary) {
      den.symboly[hodina] = h1.summary.symbol_code;
    }
    // Hodinový záznam – MET je posílá po hodině jen na nejbližší ~2-3 dny,
    // dál už po 6 hodinách. Co máme, to použijeme.
    if (h1) {
      den.hodiny.push({
        cas: bod.time.slice(11, 16),
        temp: det.air_temperature,
        code: symbolNaWmo(h1.summary && h1.summary.symbol_code),
        rain: (h1.details && h1.details.precipitation_amount) || 0,
        rainProb: (h1.details && h1.details.probability_of_precipitation != null)
          ? Math.round(h1.details.probability_of_precipitation) : null
      });
    }
  });

  const daily = Object.keys(dny).sort().map(function (datum) {
    const den = dny[datum];
    const klice = Object.keys(den.symboly);
    const symbol = klice.length ? den.symboly[klice[0]] : null;
    return {
      date: datum,
      code: symbolNaWmo(symbol),
      max: Math.round(den.max * 10) / 10,
      min: Math.round(den.min * 10) / 10,
      rain: Math.round(den.rain * 10) / 10,
      wind: Math.round(den.wind),
      hodiny: den.hodiny
    };
  });

  return {
    source: 'MET Norway (yr.no)',
    current: {
      temp: detail.air_temperature,
      feels: detail.air_temperature,          // MET pocitovou teplotu neposkytuje
      humidity: Math.round(detail.relative_humidity),
      code: symbolNaWmo(symbolTed),
      wind: Math.round(detail.wind_speed * 3.6),
      windDir: detail.wind_from_direction
    },
    daily: daily
  };
}

// ─── Hlavní handler ─────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const chyby = [];

  // Open-Meteo – až 3 pokusy (přetížení bývá jen chvilkové)
  for (let pokus = 1; pokus <= 3; pokus++) {
    try {
      const data = await zkusOpenMeteo();
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
      return res.status(200).json(data);
    } catch (e) {
      chyby.push('Open-Meteo (pokus ' + pokus + '): ' + String((e && e.message) || e));
      if (pokus < 3) {
        await new Promise(function (r) { setTimeout(r, 400 * pokus); });
      }
    }
  }

  // Záloha – MET Norway
  try {
    const data = await zkusMetNorway();
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json(data);
  } catch (e) {
    chyby.push('MET Norway: ' + String((e && e.message) || e));
  }

  // Oba zdroje selhaly
  return res.status(502).json({ error: chyby.join(' | ') });
};
