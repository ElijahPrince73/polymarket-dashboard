import path from "path";

export const CITIES = [
  {
    name: "London",
    station: "EGLC",
    lat: 51.505,
    lon: 0.055,
    tz: "Europe/London",
    aliases: ["London"],
  },
  {
    name: "Dallas",
    station: "KDAL",
    lat: 32.847,
    lon: -96.852,
    tz: "America/Chicago",
    aliases: ["Dallas", "DFW"],
  },
  {
    name: "Atlanta",
    station: "KATL",
    lat: 33.6407,
    lon: -84.4277,
    tz: "America/New_York",
    aliases: ["Atlanta", "ATL"],
  },
  {
    name: "NYC",
    station: "KJFK",
    lat: 40.6413,
    lon: -73.7781,
    tz: "America/New_York",
    aliases: ["NYC", "New York City", "New York"],
  },
  {
    name: "Seoul",
    station: "RKSI",
    lat: 37.4602,
    lon: 126.4407,
    tz: "Asia/Seoul",
    aliases: ["Seoul"],
  },
  {
    name: "Chicago",
    station: "KORD",
    lat: 41.9742,
    lon: -87.9073,
    tz: "America/Chicago",
    aliases: ["Chicago"],
  },
  {
    name: "Miami",
    station: "KMIA",
    lat: 25.7959,
    lon: -80.287,
    tz: "America/New_York",
    aliases: ["Miami"],
  },
  {
    name: "Houston",
    station: "KIAH",
    lat: 29.9902,
    lon: -95.3368,
    tz: "America/Chicago",
    aliases: ["Houston"],
  },
  {
    name: "Phoenix",
    station: "KPHX",
    lat: 33.4373,
    lon: -112.0078,
    tz: "America/Phoenix",
    aliases: ["Phoenix"],
  },
  {
    name: "Denver",
    station: "KDEN",
    lat: 39.8561,
    lon: -104.6737,
    tz: "America/Denver",
    aliases: ["Denver"],
  },
  {
    name: "Los Angeles",
    station: "KLAX",
    lat: 33.9425,
    lon: -118.4081,
    tz: "America/Los_Angeles",
    aliases: ["Los Angeles", "LA"],
  },
  {
    name: "San Francisco",
    station: "KSFO",
    lat: 37.6213,
    lon: -122.379,
    tz: "America/Los_Angeles",
    aliases: ["San Francisco", "SF"],
  },
  // --- New US cities ---
  {
    name: "Seattle",
    station: "KSEA",
    lat: 47.4502,
    lon: -122.3088,
    tz: "America/Los_Angeles",
    aliases: ["Seattle"],
  },
  {
    name: "Minneapolis",
    station: "KMSP",
    lat: 44.8831,
    lon: -93.2289,
    tz: "America/Chicago",
    aliases: ["Minneapolis"],
  },
  {
    name: "Portland",
    station: "KPDX",
    lat: 45.5898,
    lon: -122.5951,
    tz: "America/Los_Angeles",
    aliases: ["Portland"],
  },
  {
    name: "Nashville",
    station: "KBNA",
    lat: 36.1245,
    lon: -86.6782,
    tz: "America/Chicago",
    aliases: ["Nashville"],
  },
  {
    name: "Detroit",
    station: "KDTW",
    lat: 42.2124,
    lon: -83.3534,
    tz: "America/Detroit",
    aliases: ["Detroit"],
  },
  {
    name: "Las Vegas",
    station: "KLAS",
    lat: 36.0840,
    lon: -115.1537,
    tz: "America/Los_Angeles",
    aliases: ["Las Vegas"],
  },
  {
    name: "Austin",
    station: "KAUS",
    lat: 30.1944,
    lon: -97.6700,
    tz: "America/Chicago",
    aliases: ["Austin"],
  },
  // --- European cities ---
  {
    name: "Paris",
    station: "LFPG",
    lat: 48.8566,
    lon: 2.3522,
    tz: "Europe/Paris",
    aliases: ["Paris"],
  },
  {
    name: "Berlin",
    station: "EDDB",
    lat: 52.5200,
    lon: 13.4050,
    tz: "Europe/Berlin",
    aliases: ["Berlin"],
  },
  {
    name: "Madrid",
    station: "LEMD",
    lat: 40.4168,
    lon: -3.7038,
    tz: "Europe/Madrid",
    aliases: ["Madrid"],
  },
  // --- Asia cities ---
  {
    name: "Tokyo",
    station: "RJTT",
    lat: 35.6762,
    lon: 139.6503,
    tz: "Asia/Tokyo",
    aliases: ["Tokyo"],
  },
  {
    name: "Mumbai",
    station: "VABB",
    lat: 19.0760,
    lon: 72.8777,
    tz: "Asia/Kolkata",
    aliases: ["Mumbai"],
  },
  {
    name: "Bangkok",
    station: "VTBS",
    lat: 13.7563,
    lon: 100.5018,
    tz: "Asia/Bangkok",
    aliases: ["Bangkok"],
  },
  {
    name: "Singapore",
    station: "WSSS",
    lat: 1.3521,
    lon: 103.8198,
    tz: "Asia/Singapore",
    aliases: ["Singapore"],
  },
  // --- Oceania ---
  {
    name: "Sydney",
    station: "YSSY",
    lat: -33.8688,
    lon: 151.2093,
    tz: "Australia/Sydney",
    aliases: ["Sydney"],
  },
  {
    name: "Wellington",
    station: "NZWN",
    lat: -41.2865,
    lon: 174.7762,
    tz: "Pacific/Auckland",
    aliases: ["Wellington"],
  },
  // --- Americas ---
  {
    name: "Toronto",
    station: "CYYZ",
    lat: 43.6532,
    lon: -79.3832,
    tz: "America/Toronto",
    aliases: ["Toronto"],
  },
  {
    name: "Sao Paulo",
    station: "SBGR",
    lat: -23.5505,
    lon: -46.6333,
    tz: "America/Sao_Paulo",
    aliases: ["Sao Paulo", "São Paulo"],
  },
  {
    name: "Mexico City",
    station: "MMMX",
    lat: 19.4326,
    lon: -99.1332,
    tz: "America/Mexico_City",
    aliases: ["Mexico City"],
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
};

export const BASE_BANKROLL = 100;
export const MIN_EDGE = 0.25; // Raised from 0.15 to 0.25 (25% minimum edge)
export const MIN_PRICE = 0.15;
export const MAX_PRICE = 0.85;
export const MIN_ABS_MODEL_DIFF = 0.12; // Raised from 0.08 to 0.12 for higher confidence
export const MIN_HOURS_TO_CLOSE = 3;
export const MIN_MODEL_CONSENSUS = 4; // Require 4+ weather models to agree
export const MAX_DAILY_EXPOSURE_PCT = 0.25;
export const MAX_CITY_EXPOSURE_PCT = 0.04;
export const STOP_DAILY_DD_PCT = 0.05;

export const SEARCH_TERMS = ["temperature", "rain", "precipitation", "snow", "wind"];

export const DB_PATH = path.resolve(process.cwd(), "data", "trades.db");
