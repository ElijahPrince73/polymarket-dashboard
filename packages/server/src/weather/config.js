import path from "path";

export const CITIES = [
  {
    name: "London",
    station: "EGLC",
    lat: 51.5048,
    lon: 0.0495,
    tz: "Europe/London",
    unit: "C",
    aliases: ["London"],
  },
  {
    name: "Dallas",
    station: "KDAL",
    lat: 32.847,
    lon: -96.852,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Dallas", "DFW"],
  },
  {
    name: "Atlanta",
    station: "KATL",
    lat: 33.6407,
    lon: -84.4277,
    tz: "America/New_York",
    unit: "F",
    aliases: ["Atlanta", "ATL"],
  },
  {
    name: "NYC",
    station: "KLGA",
    lat: 40.7772,
    lon: -73.8726,
    tz: "America/New_York",
    unit: "F",
    aliases: ["NYC", "New York City", "New York", "LaGuardia"],
  },
  {
    name: "Seoul",
    station: "RKSI",
    lat: 37.4691,
    lon: 126.4505,
    tz: "Asia/Seoul",
    unit: "C",
    aliases: ["Seoul"],
  },
  {
    name: "Chicago",
    station: "KORD",
    lat: 41.9742,
    lon: -87.9073,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Chicago"],
  },
  {
    name: "Miami",
    station: "KMIA",
    lat: 25.7959,
    lon: -80.287,
    tz: "America/New_York",
    unit: "F",
    aliases: ["Miami"],
    enabled: false, // cut 2026-04-20: -59% ROI, convective subtropical forecasts too noisy
  },
  {
    // Polymarket resolves on KHOU (William P. Hobby), not KIAH (Intercontinental).
    name: "Houston",
    station: "KHOU",
    lat: 29.6454,
    lon: -95.2789,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Houston"],
    enabled: false, // cut 2026-04-20: -49% ROI, Gulf moisture instability
  },
  {
    name: "Phoenix",
    station: "KPHX",
    lat: 33.4373,
    lon: -112.0078,
    tz: "America/Phoenix",
    unit: "F",
    aliases: ["Phoenix"],
  },
  {
    // Polymarket resolves on KBKF (Buckley Space Force Base, Aurora), not KDEN.
    name: "Denver",
    station: "KBKF",
    lat: 39.7017,
    lon: -104.7517,
    tz: "America/Denver",
    unit: "F",
    aliases: ["Denver"],
  },
  {
    name: "Los Angeles",
    station: "KLAX",
    lat: 33.9425,
    lon: -118.4081,
    tz: "America/Los_Angeles",
    unit: "F",
    aliases: ["Los Angeles", "LA"],
  },
  {
    name: "San Francisco",
    station: "KSFO",
    lat: 37.6213,
    lon: -122.379,
    tz: "America/Los_Angeles",
    unit: "F",
    aliases: ["San Francisco", "SF"],
  },
  // --- New US cities ---
  {
    name: "Seattle",
    station: "KSEA",
    lat: 47.4502,
    lon: -122.3088,
    tz: "America/Los_Angeles",
    unit: "F",
    aliases: ["Seattle"],
  },
  {
    name: "Minneapolis",
    station: "KMSP",
    lat: 44.8831,
    lon: -93.2289,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Minneapolis"],
  },
  {
    name: "Portland",
    station: "KPDX",
    lat: 45.5898,
    lon: -122.5951,
    tz: "America/Los_Angeles",
    unit: "F",
    aliases: ["Portland"],
  },
  {
    name: "Nashville",
    station: "KBNA",
    lat: 36.1245,
    lon: -86.6782,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Nashville"],
  },
  {
    name: "Detroit",
    station: "KDTW",
    lat: 42.2124,
    lon: -83.3534,
    tz: "America/Detroit",
    unit: "F",
    aliases: ["Detroit"],
  },
  {
    name: "Las Vegas",
    station: "KLAS",
    lat: 36.0840,
    lon: -115.1537,
    tz: "America/Los_Angeles",
    unit: "F",
    aliases: ["Las Vegas"],
  },
  {
    name: "Austin",
    station: "KAUS",
    lat: 30.1944,
    lon: -97.6700,
    tz: "America/Chicago",
    unit: "F",
    aliases: ["Austin"],
  },
  // --- European cities ---
  {
    // Polymarket resolves on LFPB (Paris–Le Bourget), not LFPG (CDG).
    name: "Paris",
    station: "LFPB",
    lat: 48.9694,
    lon: 2.4414,
    tz: "Europe/Paris",
    unit: "C",
    aliases: ["Paris"],
    enabled: false, // cut 2026-04-20: -43% ROI, station-exact avgError 5.2°C too wide for 1°C buckets
  },
  {
    name: "Berlin",
    station: "EDDB",
    lat: 52.3667,
    lon: 13.5033,
    tz: "Europe/Berlin",
    unit: "C",
    aliases: ["Berlin"],
  },
  {
    name: "Madrid",
    station: "LEMD",
    lat: 40.4934,
    lon: -3.5722,
    tz: "Europe/Madrid",
    unit: "C",
    aliases: ["Madrid"],
    enabled: false, // cut 2026-04-20: -16% ROI across 35 trades, persistent forecast bias
  },
  // --- Asia cities ---
  {
    // Station code RJTT is Haneda; earlier lat/lon was pointing at Narita (~60 km off).
    name: "Tokyo",
    station: "RJTT",
    lat: 35.5494,
    lon: 139.7798,
    tz: "Asia/Tokyo",
    unit: "C",
    aliases: ["Tokyo"],
  },
  {
    name: "Mumbai",
    station: "VABB",
    lat: 19.0887,
    lon: 72.8679,
    tz: "Asia/Kolkata",
    unit: "C",
    aliases: ["Mumbai"],
  },
  {
    name: "Bangkok",
    station: "VTBS",
    lat: 13.6811,
    lon: 100.747,
    tz: "Asia/Bangkok",
    unit: "C",
    aliases: ["Bangkok"],
  },
  {
    name: "Singapore",
    station: "WSSS",
    lat: 1.3502,
    lon: 103.9940,
    tz: "Asia/Singapore",
    unit: "C",
    aliases: ["Singapore"],
  },
  // --- Oceania ---
  {
    name: "Sydney",
    station: "YSSY",
    lat: -33.9461,
    lon: 151.1772,
    tz: "Australia/Sydney",
    unit: "C",
    aliases: ["Sydney"],
  },
  {
    name: "Wellington",
    station: "NZWN",
    lat: -41.3272,
    lon: 174.8052,
    tz: "Pacific/Auckland",
    unit: "C",
    aliases: ["Wellington"],
  },
  // --- Americas ---
  {
    name: "Toronto",
    station: "CYYZ",
    lat: 43.6772,
    lon: -79.6306,
    tz: "America/Toronto",
    unit: "C",
    aliases: ["Toronto"],
  },
  {
    name: "Sao Paulo",
    station: "SBGR",
    lat: -23.4356,
    lon: -46.4731,
    tz: "America/Sao_Paulo",
    unit: "C",
    aliases: ["Sao Paulo", "São Paulo"],
    enabled: false, // cut 2026-04-20: -10% ROI, tropical convection hard to forecast
  },
  {
    name: "Mexico City",
    station: "MMMX",
    lat: 19.4333,
    lon: -99.0667,
    tz: "America/Mexico_City",
    unit: "C",
    aliases: ["Mexico City"],
  },
  // --- Additional Polymarket-covered cities (added 2026-04-20) ---
  // Stations + coords sourced from Polymarket resolutionSource URLs; timezone
  // set to IANA zone covering each airport.
  {
    name: "Amsterdam",
    station: "EHAM",
    lat: 52.3086,
    lon: 4.7639,
    tz: "Europe/Amsterdam",
    unit: "C",
    aliases: ["Amsterdam"],
  },
  {
    // Polymarket's URL: /tr/çubuk/LTAC — the WU station is in the Esenboğa
    // (çubuk) area even though LTAC is formally Güvercinlik. Coords here
    // follow WU's stated location, not the ICAO registry.
    name: "Ankara",
    station: "LTAC",
    lat: 40.1281,
    lon: 32.9951,
    tz: "Europe/Istanbul",
    unit: "C",
    aliases: ["Ankara"],
  },
  {
    name: "Beijing",
    station: "ZBAA",
    lat: 40.0801,
    lon: 116.5847,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Beijing"],
  },
  {
    name: "Buenos Aires",
    station: "SAEZ",
    lat: -34.8222,
    lon: -58.5358,
    tz: "America/Argentina/Buenos_Aires",
    unit: "C",
    aliases: ["Buenos Aires", "BA"],
  },
  {
    name: "Busan",
    station: "RKPK",
    lat: 35.1795,
    lon: 128.9380,
    tz: "Asia/Seoul",
    unit: "C",
    aliases: ["Busan"],
  },
  {
    name: "Cape Town",
    station: "FACT",
    lat: -33.9649,
    lon: 18.6017,
    tz: "Africa/Johannesburg",
    unit: "C",
    aliases: ["Cape Town"],
  },
  {
    name: "Chengdu",
    station: "ZUUU",
    lat: 30.5785,
    lon: 103.9471,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Chengdu"],
  },
  {
    name: "Chongqing",
    station: "ZUCK",
    lat: 29.7192,
    lon: 106.6419,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Chongqing"],
  },
  {
    name: "Helsinki",
    station: "EFHK",
    lat: 60.3172,
    lon: 24.9633,
    tz: "Europe/Helsinki",
    unit: "C",
    aliases: ["Helsinki"],
  },
  {
    // HK event description: "Hong Kong Observatory" is the resolution source.
    // Market never published a Wunderground URL in resolutionSource, so the
    // ICAO is inferred. Coords point at HKO HQ in Tsim Sha Tsui.
    name: "Hong Kong",
    station: "VHHH",
    lat: 22.3024,
    lon: 114.1746,
    tz: "Asia/Hong_Kong",
    unit: "C",
    aliases: ["Hong Kong", "HK"],
  },
  {
    // Polymarket uses WIHH (Halim), not WIII (Soekarno-Hatta).
    name: "Jakarta",
    station: "WIHH",
    lat: -6.2667,
    lon: 106.8908,
    tz: "Asia/Jakarta",
    unit: "C",
    aliases: ["Jakarta"],
  },
  {
    name: "Jeddah",
    station: "OEJN",
    lat: 21.6796,
    lon: 39.1565,
    tz: "Asia/Riyadh",
    unit: "C",
    aliases: ["Jeddah"],
  },
  {
    name: "Kuala Lumpur",
    station: "WMKK",
    lat: 2.7456,
    lon: 101.7072,
    tz: "Asia/Kuala_Lumpur",
    unit: "C",
    aliases: ["Kuala Lumpur", "KL"],
  },
  {
    name: "Lagos",
    station: "DNMM",
    lat: 6.5774,
    lon: 3.3211,
    tz: "Africa/Lagos",
    unit: "C",
    aliases: ["Lagos"],
  },
  {
    name: "Lucknow",
    station: "VILK",
    lat: 26.7606,
    lon: 80.8893,
    tz: "Asia/Kolkata",
    unit: "C",
    aliases: ["Lucknow"],
  },
  {
    name: "Milan",
    station: "LIMC",
    lat: 45.6306,
    lon: 8.7281,
    tz: "Europe/Rome",
    unit: "C",
    aliases: ["Milan", "Milano"],
  },
  {
    name: "Munich",
    station: "EDDM",
    lat: 48.3538,
    lon: 11.7861,
    tz: "Europe/Berlin",
    unit: "C",
    aliases: ["Munich", "München"],
  },
  {
    name: "Shanghai",
    station: "ZSPD",
    lat: 31.1434,
    lon: 121.8052,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Shanghai"],
  },
  {
    name: "Shenzhen",
    station: "ZGSZ",
    lat: 22.6394,
    lon: 113.8108,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Shenzhen"],
  },
  {
    name: "Taipei",
    station: "RCSS",
    lat: 25.0694,
    lon: 121.5522,
    tz: "Asia/Taipei",
    unit: "C",
    aliases: ["Taipei"],
  },
  {
    name: "Warsaw",
    station: "EPWA",
    lat: 52.1657,
    lon: 20.9671,
    tz: "Europe/Warsaw",
    unit: "C",
    aliases: ["Warsaw", "Warszawa"],
  },
  {
    name: "Wuhan",
    station: "ZHHH",
    lat: 30.7838,
    lon: 114.2081,
    tz: "Asia/Shanghai",
    unit: "C",
    aliases: ["Wuhan"],
  },
];

// Short-range models: highest resolution, best for 0-48hr forecasts
// Global models: lower resolution but work for 3+ day forecasts
// The blending function uses both — short-range models that return data
// for the target date are included alongside global models.
export const MODEL_CANDIDATES = {
  London: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Dallas: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Atlanta: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  NYC: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Seoul: {
    shortRange: ["jma_msm"],
    global: ["jma_gsm", "ecmwf_ifs025", "icon_global", "cma_grapes_global", "gem_global"],
  },
  Chicago: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Miami: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Houston: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Phoenix: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Denver: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Los Angeles": {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "San Francisco": {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  // New US cities
  Seattle: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Minneapolis: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Portland: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Nashville: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Detroit: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Las Vegas": {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Austin: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  // European cities
  Paris: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Berlin: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Madrid: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  // Asia cities
  Tokyo: {
    shortRange: ["jma_msm"],
    global: ["jma_gsm", "ecmwf_ifs025", "icon_global", "cma_grapes_global", "gem_global"],
  },
  Mumbai: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Bangkok: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Singapore: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  // Oceania
  Sydney: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Wellington: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  // Americas
  Toronto: {
    shortRange: ["ncep_hrrr_conus", "ncep_nam_conus"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Sao Paulo": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Mexico City": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  // --- Added 2026-04-20 (Polymarket coverage expansion) ---
  Amsterdam: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Ankara: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Beijing: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  "Buenos Aires": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Busan: {
    shortRange: ["jma_msm"],
    global: ["jma_gsm", "ecmwf_ifs025", "icon_global", "cma_grapes_global", "gem_global"],
  },
  "Cape Town": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Chengdu: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Chongqing: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Helsinki: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Hong Kong": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Jakarta: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Jeddah: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  "Kuala Lumpur": {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Lagos: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Lucknow: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Milan: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Munich: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Shanghai: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Shenzhen: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
  Taipei: {
    shortRange: [],
    global: ["jma_gsm", "ecmwf_ifs025", "icon_global", "cma_grapes_global", "gem_global"],
  },
  Warsaw: {
    shortRange: ["icon_eu"],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global"],
  },
  Wuhan: {
    shortRange: [],
    global: ["ecmwf_ifs025", "gfs_seamless", "icon_global", "gem_global", "cma_grapes_global"],
  },
};

export const BASE_BANKROLL = 1000;
export const MIN_EDGE = 0.25; // Raised from 0.15 to 0.25 (25% minimum edge)
export const MIN_PRICE = 0.15;
export const MAX_PRICE = 0.85;
export const MIN_ABS_MODEL_DIFF = 0.12; // Raised from 0.08 to 0.12 for higher confidence
export const MIN_HOURS_TO_CLOSE = 3;
export const MIN_MODEL_CONSENSUS = 4; // Require 4+ weather models to agree
export const MIN_VOLUME = 50; // Weather markets are niche — most buckets are $100-$500
export const MAX_DAILY_EXPOSURE_PCT = 0.25;
export const MAX_CITY_EXPOSURE_PCT = 0.04;
export const STOP_DAILY_DD_PCT = 0.05;
export const SIGMA_F = 2.0;
export const SIGMA_C = 1.2;
export const MAX_SLIPPAGE = 0.12; // Weather markets have wider spreads than crypto

export const SEARCH_TERMS = ["highest temperature"]; // Only trade temp_max markets — fewer API calls

export const DB_PATH = path.resolve(process.cwd(), "data", "trades.db");
