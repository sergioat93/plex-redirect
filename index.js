const express = require('express');
const https = require('https');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
// const compression = require('compression');
// const NodeCache = require('node-cache');
const app = express();

// Middleware para parsear JSON en el body de las peticiones
app.use(express.json());

// ⚠️ IMPORTANTE: Reemplaza esto con tu propia API Key de TMDB
// Obtén una gratis en: https://www.themoviedb.org/settings/api
const TMDB_API_KEY = '5aaa0a6844d70ade130e868275ee2cc2';

// ========================================
// CONFIGURACIÓN MONGODB
// ========================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://plexadmin:Sporting1905.@plex-redirect.nrifwco.mongodb.net/?appName=Plex-Redirect';
const MONGODB_DB = process.env.MONGODB_DB || 'plex_servers';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '159357456';

let mongoClient = null;
let serversCollection = null;

// Conectar a MongoDB
async function connectMongoDB() {
  if (mongoClient) return mongoClient;
  
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db(MONGODB_DB);
    serversCollection = db.collection('servers');
    
    // Crear índices
    await serversCollection.createIndex({ machineIdentifier: 1 }, { unique: true });
    await serversCollection.createIndex({ lastAccess: -1 });
    await serversCollection.createIndex({ 'tokens.tokenHash': 1 });
    
    console.log('✅ Conectado a MongoDB Atlas');
    return mongoClient;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    return null;
  }
}

// Iniciar conexión al arrancar
connectMongoDB();

// ========================================
// OPTIMIZACIONES DE RENDIMIENTO
// ========================================

// 1. Compresión gzip/brotli para todas las respuestas
// app.use(compression());

// 2. Cache en memoria (node-cache)
// TTL: 24 horas para TMDB, 1 hora para XML de Plex
// const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); // 24h
// const plexCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1h

// Cache simple en memoria sin dependencias
const tmdbCache = new Map();
const plexCache = new Map();

// 3. Connection pooling - reutilizar conexiones HTTPS
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 30000
});

// Función helper para hacer requests HTTPS que devuelve JSON (con cache)
function httpsGet(url, useCache = true, cacheKey = null) {
    return new Promise((resolve, reject) => {
        // Intentar obtener del cache si está habilitado
        const key = cacheKey || url;
        if (useCache) {
            const cached = tmdbCache.get(key);
            if (cached) return resolve(cached);
        }
        
        https.get(url, { agent: httpsAgent }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (useCache) {
                        tmdbCache.set(key, parsed);
                        // Limpiar cache después de 24 horas
                        setTimeout(() => tmdbCache.delete(key), 86400000);
                    }
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Función helper para hacer requests HTTPS que devuelve texto plano (XML) (con cache)
function httpsGetXML(url, useCache = true) {
    return new Promise((resolve, reject) => {
        // Intentar obtener del cache Plex si está habilitado
        if (useCache) {
            const cached = plexCache.get(url);
            if (cached) return resolve(cached);
        }
        
        https.get(url, { agent: httpsAgent }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (useCache) {
                    plexCache.set(url, data);
                    // Limpiar cache después de 1 hora
                    setTimeout(() => plexCache.delete(url), 3600000);
                }
                resolve(data);
            });
        }).on('error', reject);
    });
}

// Función para decodificar HTML entities
function decodeHtmlEntities(text) {
    if (!text) return text;
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#225;': 'á',
        '&#233;': 'é',
        '&#237;': 'í',
        '&#243;': 'ó',
        '&#250;': 'ú',
        '&#193;': 'Á',
        '&#201;': 'É',
        '&#205;': 'Í',
        '&#211;': 'Ó',
        '&#218;': 'Ú',
        '&#241;': 'ñ',
        '&#209;': 'Ñ',
        '&#191;': '¿',
        '&#161;': '¡'
    };
    
    // Reemplazar entidades nombradas
    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
        decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }
    
    // Reemplazar entidades numéricas generales &#XXXX;
    decoded = decoded.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    
    return decoded;
}

// Función simple para parsear XML de Plex (sin dependencias externas)
function parseXML(xmlString) {
    const result = {
        MediaContainer: {
            Metadata: []
        }
    };
    
    // Extraer atributos del MediaContainer
    const mediaContainerMatch = xmlString.match(/<MediaContainer\s+([^>]*?)>/);
    if (mediaContainerMatch) {
        const containerAttrs = mediaContainerMatch[1];
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(containerAttrs)) !== null) {
            const [, key, value] = attrMatch;
            result.MediaContainer[key] = value;
        }
    }
    
    // Extraer tag Video principal (solo el primer nivel, no los anidados)
    const videoTagRegex = /<Video\s+([^>]*?)(?:>[\s\S]*?<\/Video>|\/?>)/g;
    const videoMatches = xmlString.matchAll(videoTagRegex);
    
    for (const videoMatch of videoMatches) {
        const videoAttrs = videoMatch[1];
        const fullVideoTag = videoMatch[0];
        const episode = {};
        
        // Extraer atributos del tag Video (solo del tag principal, no de hijos)
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(videoAttrs)) !== null) {
            const [, key, value] = attrMatch;
            episode[key] = value;
        }
        
        // Buscar TODOS los tags Media (puede haber múltiples para diferentes calidades)
        const mediaRegex = /<Media\s+([^>]*?)(?:>[\s\S]*?<\/Media>|\/?>)/g;
        const mediaMatches = fullVideoTag.matchAll(mediaRegex);
        episode.Media = [];
        
        for (const mediaMatch of mediaMatches) {
            const mediaAttrs = mediaMatch[1];
            const fullMediaTag = mediaMatch[0];
            const media = {};
            
            // Extraer atributos de Media
            const mediaAttrRegex = /(\w+)="([^"]*)"/g;
            let mediaAttrMatch;
            while ((mediaAttrMatch = mediaAttrRegex.exec(mediaAttrs)) !== null) {
                const [, key, value] = mediaAttrMatch;
                media[key] = value;
            }
            
            // Buscar tag Part dentro de este Media específico
            const partRegex = /<Part\s+([^>]*?)(?:>[\s\S]*?<\/Part>|\/?>)/;
            const partMatch = fullMediaTag.match(partRegex);
            
            if (partMatch) {
                const partAttrs = partMatch[1];
                media.Part = [{}];
                
                // Extraer atributos de Part
                const partAttrRegex = /(\w+)="([^"]*)"/g;
                let partAttrMatch;
                while ((partAttrMatch = partAttrRegex.exec(partAttrs)) !== null) {
                    const [, key, value] = partAttrMatch;
                    media.Part[0][key] = value;
                }
            }
            
            episode.Media.push(media);
        }
        
        result.MediaContainer.Metadata.push(episode);
    }
    
    return result;
}

// Función para obtener datos de TMDB
async function fetchTMDBData(tmdbId, type = 'tv') {
    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
        
        const data = await httpsGet(url);
        return {
            title: data.name || data.title,
            overview: data.overview,
            posterPath: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            releaseYear: data.first_air_date ? new Date(data.first_air_date).getFullYear() : 
                        data.release_date ? new Date(data.release_date).getFullYear() : null
        };
    } catch (error) {
        console.error('Error fetching TMDB data:', error);
        return null;
    }
}

// Función para obtener datos específicos de temporada de TMDB
async function fetchTMDBSeasonData(tmdbId, seasonNumber = 1) {
    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
        
        const data = await httpsGet(url);
        return {
            name: data.name,
            overview: data.overview,
            posterPath: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            airDate: data.air_date
        };
    } catch (error) {
        console.error('Error fetching TMDB season data:', error);
        return null;
    }
}

// Función para obtener datos completos de película desde TMDB
async function fetchTMDBMovieData(tmdbId, plexRating = null) {
    try {
        // Obtener datos básicos de la película
        const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
        const movieData = await httpsGet(movieUrl);
        
        // Extraer géneros
        const genres = movieData.genres ? movieData.genres.map(g => g.name) : [];
        
        // Extraer director del crew
        const director = movieData.credits && movieData.credits.crew 
            ? movieData.credits.crew.find(person => person.job === 'Director')?.name || 'N/A'
            : 'N/A';
        
        // Extraer primeros 5 actores del cast
        const cast = movieData.credits && movieData.credits.cast
            ? movieData.credits.cast.slice(0, 5).map(actor => actor.name).join(', ')
            : 'N/A';
        
        // Extraer trailer de YouTube
        const trailer = movieData.videos && movieData.videos.results
            ? movieData.videos.results.find(video => video.type === 'Trailer' && video.site === 'YouTube')
            : null;
        
        // Formatear presupuesto y recaudación
        const formatCurrency = (amount) => {
            if (!amount || amount === 0) return 'N/A';
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount);
        };
        
        // Formatear duración
        const formatRuntime = (minutes) => {
            if (!minutes) return 'N/A';
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}min`;
        };
        
        return {
            title: movieData.title || 'Sin título',
            originalTitle: movieData.original_title || 'N/A',
            tagline: movieData.tagline || '',
            overview: movieData.overview || 'Sin descripción disponible',
            posterPath: movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : null,
            backdropPath: movieData.backdrop_path ? `https://image.tmdb.org/t/p/original${movieData.backdrop_path}` : null,
            releaseDate: movieData.release_date || 'N/A',
            year: movieData.release_date ? new Date(movieData.release_date).getFullYear() : 'N/A',
            runtime: formatRuntime(movieData.runtime),
            runtimeMinutes: movieData.runtime || 0,
            genres: genres,
            genresString: genres.join(', ') || 'N/A',
            rating: plexRating ? plexRating.toFixed(1) : (movieData.vote_average ? movieData.vote_average.toFixed(1) : 'N/A'),
            voteCount: movieData.vote_count ? movieData.vote_count.toLocaleString('es-ES') : 'N/A',
            budget: formatCurrency(movieData.budget),
            revenue: formatCurrency(movieData.revenue),
            director: director,
            cast: cast,
            originalLanguage: movieData.original_language ? movieData.original_language.toUpperCase() : 'N/A',
            countries: movieData.production_countries ? movieData.production_countries.map(c => c.name).join(', ') : 'N/A',
            imdbId: movieData.imdb_id || null,
            trailerKey: trailer ? trailer.key : null
        };
    } catch (error) {
        console.error('Error fetching TMDB movie data:', error);
        return null;
    }
}

// Función para obtener datos completos de serie desde TMDB
async function fetchTMDBSeriesData(tmdbId) {
    try {
        // Obtener datos básicos de la serie
        const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos,external_ids`;
        const seriesData = await httpsGet(seriesUrl);
        
        // Extraer géneros
        const genres = seriesData.genres ? seriesData.genres.map(g => g.name) : [];
        
        // Extraer creadores
        const creators = seriesData.created_by && seriesData.created_by.length > 0
            ? seriesData.created_by.map(c => c.name).join(', ')
            : 'N/A';
        
        // Extraer primeros 5 actores del cast
        const cast = seriesData.credits && seriesData.credits.cast
            ? seriesData.credits.cast.slice(0, 5).map(actor => actor.name).join(', ')
            : 'N/A';
        
        // Extraer trailer de YouTube
        const trailer = seriesData.videos && seriesData.videos.results
            ? seriesData.videos.results.find(video => video.type === 'Trailer' && video.site === 'YouTube')
            : null;
        
        // Determinar estado de la serie
        const getStatus = (status) => {
            const statusMap = {
                'Returning Series': 'En emisión',
                'Ended': 'Finalizada',
                'Canceled': 'Cancelada',
                'In Production': 'En producción',
                'Planned': 'Planificada'
            };
            return statusMap[status] || status || 'Desconocido';
        };
        
        // Calcular duración promedio de episodios
        const formatRuntime = (minutes) => {
            if (!minutes || minutes.length === 0) return 'N/A';
            const avgMinutes = Array.isArray(minutes) ? minutes[0] : minutes;
            return `${avgMinutes} min`;
        };
        
        return {
            title: seriesData.name || 'Sin título',
            originalTitle: seriesData.original_name || 'N/A',
            tagline: seriesData.tagline || '',
            overview: seriesData.overview || 'Sin descripción disponible',
            posterPath: seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : null,
            backdropPath: seriesData.backdrop_path ? `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}` : null,
            firstAirDate: seriesData.first_air_date || 'N/A',
            lastAirDate: seriesData.last_air_date || 'N/A',
            year: seriesData.first_air_date ? new Date(seriesData.first_air_date).getFullYear() : 'N/A',
            status: getStatus(seriesData.status),
            numberOfSeasons: seriesData.number_of_seasons || 0,
            numberOfEpisodes: seriesData.number_of_episodes || 0,
            episodeRuntime: formatRuntime(seriesData.episode_run_time),
            genres: genres,
            genresString: genres.join(', ') || 'N/A',
            rating: seriesData.vote_average ? seriesData.vote_average.toFixed(1) : 'N/A',
            voteCount: seriesData.vote_count ? seriesData.vote_count.toLocaleString('es-ES') : 'N/A',
            creators: creators,
            cast: cast,
            originalLanguage: seriesData.original_language ? seriesData.original_language.toUpperCase() : 'N/A',
            countries: seriesData.production_countries ? seriesData.production_countries.map(c => c.name).join(', ') : 'N/A',
            networks: seriesData.networks ? seriesData.networks.map(n => n.name).join(', ') : 'N/A',
            imdbId: seriesData.external_ids && seriesData.external_ids.imdb_id ? seriesData.external_ids.imdb_id : null,
            trailerKey: trailer ? trailer.key : null,
            inProduction: seriesData.in_production || false
        };
    } catch (error) {
        console.error('Error fetching TMDB series data:', error);
        return null;
    }
}

app.get('/', (req, res) => {
  const {
    accessToken = '',
    partKey: encodedPartKey = '',
    baseURI = '',
    fileSize = '',
    fileName = '',
    downloadURL = '',
    title = '',
    episodeTitle = '',
    seasonNumber = '',
    episodeNumber = '',
    posterUrl = '',
    autoDownload = '',
    closeAfter = '0'
  } = req.query;
  
  // Decodificar el partKey para mostrar espacios en lugar de %20
  const partKey = decodeURIComponent(encodedPartKey);

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Iniciando descarga - Infinity Scrap</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1f2937;
          color: #f3f4f6;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }
        
        body::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(229, 160, 13, 0.1) 0%, transparent 70%);
          animation: rotate 20s linear infinite;
        }
        
        @keyframes rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .container {
          position: relative;
          z-index: 1;
          text-align: center;
          max-width: 500px;
          width: 100%;
        }
        
        .logo-container {
          margin-bottom: 60px;
          animation: fadeInDown 0.6s ease-out;
        }
        
        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateY(-30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .logo {
          display: inline-flex;
          align-items: center;
          gap: 16px;
        }
        
        .logo-icon {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 24px rgba(229, 160, 13, 0.4);
        }
        
        .logo-icon svg {
          width: 32px;
          height: 32px;
          fill: #000;
        }
        
        .logo-text {
          font-size: 2rem;
          font-weight: 800;
          background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .download-card {
          background: rgba(31, 41, 55, 0.8);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 60px 40px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(229, 160, 13, 0.2);
          animation: fadeInUp 0.6s ease-out 0.2s both;
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .download-icon-container {
          margin-bottom: 32px;
          position: relative;
          display: inline-block;
        }
        
        .download-icon {
          width: 80px;
          height: 80px;
          background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 32px rgba(229, 160, 13, 0.4);
          animation: pulse 2s ease-in-out infinite;
          position: relative;
          z-index: 2;
        }
        
        .download-icon svg {
          width: 40px;
          height: 40px;
          fill: #000;
          animation: bounce 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 12px 32px rgba(229, 160, 13, 0.4);
          }
          50% {
            transform: scale(1.05);
            box-shadow: 0 12px 40px rgba(229, 160, 13, 0.6);
          }
        }
        
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        
        .ripple {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 80px;
          height: 80px;
          margin: -40px 0 0 -40px;
          border-radius: 50%;
          border: 2px solid #e5a00d;
          opacity: 0;
          animation: ripple 2s ease-out infinite;
        }
        
        .ripple:nth-child(2) {
          animation-delay: 0.5s;
        }
        
        .ripple:nth-child(3) {
          animation-delay: 1s;
        }
        
        @keyframes ripple {
          0% {
            transform: scale(1);
            opacity: 0.6;
          }
          100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        
        .title {
          font-size: 1.75rem;
          font-weight: 700;
          color: #f9fafb;
          margin-bottom: 16px;
          letter-spacing: -0.5px;
        }
        
        .subtitle {
          font-size: 1rem;
          color: #9ca3af;
          margin-bottom: 40px;
          font-weight: 500;
        }
        
        .countdown-container {
          display: inline-block;
          position: relative;
        }
        
        .countdown {
          font-size: 4rem;
          font-weight: 800;
          background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
          display: block;
          min-width: 100px;
          animation: scaleIn 1s ease-in-out infinite;
        }
        
        @keyframes scaleIn {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        
        .progress-bar {
          width: 100%;
          height: 4px;
          background: rgba(229, 160, 13, 0.2);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 40px;
        }
        
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #e5a00d 0%, #f5b81d 100%);
          width: 0%;
          animation: progress 3s linear;
          border-radius: 2px;
        }
        
        @keyframes progress {
          from {
            width: 0%;
          }
          to {
            width: 100%;
          }
        }
        
        @media (max-width: 640px) {
          .download-card {
            padding: 40px 24px;
          }
          
          .logo-text {
            font-size: 1.5rem;
          }
          
          .title {
            font-size: 1.5rem;
          }
          
          .countdown {
            font-size: 3rem;
          }
          
          .download-icon {
            width: 64px;
            height: 64px;
          }
          
          .download-icon svg {
            width: 32px;
            height: 32px;
          }
        }
      </style>
      <script>
        let countdown = 3;
        const autoDownload = '${autoDownload}' === 'true';
        const closeAfter = parseInt('${closeAfter}') || 0;
        
        window.onload = function() {
          if (autoDownload) {
            window.location.href = "${downloadURL}";
            if (closeAfter > 0) {
              setTimeout(function() {
                try {
                  window.close();
                } catch (e) {
                  document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Inter, sans-serif; color: #9ca3af;">Descarga iniciada. Puedes cerrar esta pestaña.</div>';
                }
              }, closeAfter);
            }
            return;
          }
          
          const countdownEl = document.getElementById('countdown');
          const interval = setInterval(function() {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            if (countdown <= 0) {
              clearInterval(interval);
              window.location.href = "${downloadURL}";
            }
          }, 1000);
        }
      </script>
    </head>
    <body>
      <div class="container">
        <div class="logo-container">
          <div class="logo">
            <div class="logo-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H9.5v-2h-2v2H6V7h1.5v2.5h2V7H11v10zm5 0h-1.75l-1.75-2.25V17H13V7h1.5v2.25L16.25 7H18l-2.25 3L18 13v4z"/>
              </svg>
            </div>
            <span class="logo-text">Infinity Scrap</span>
          </div>
        </div>
        
        <div class="download-card">
          <div class="download-icon-container">
            <div class="ripple"></div>
            <div class="ripple"></div>
            <div class="ripple"></div>
            <div class="download-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
            </div>
          </div>
          
          <h1 class="title">Iniciando descarga</h1>
          <p class="subtitle">Tu archivo se descargará automáticamente</p>
          
          <div class="countdown-container">
            <div class="countdown" id="countdown">3</div>
          </div>
          
          <div class="progress-bar">
            <div class="progress-fill"></div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/episode', async (req, res) => {
  const episodeRatingKey = req.query.episodeRatingKey;
  const accessToken = req.query.accessToken;
  const baseURI = req.query.baseURI;
  const seasonRatingKey = req.query.seasonRatingKey;
  const seasonNumber = req.query.seasonNumber;
  const episodeNumber = req.query.episodeNumber;
  const seriesTitle = req.query.seriesTitle;
  const tmdbId = req.query.tmdbId;
  const imdbId = req.query.imdbId;
  const parentRatingKey = req.query.parentRatingKey;
  let libraryKey = req.query.libraryKey || '';
  let libraryTitle = req.query.libraryTitle || '';

  if (!episodeRatingKey || !accessToken || !baseURI) {
    return res.status(400).send('Faltan parámetros requeridos: episodeRatingKey, accessToken, baseURI');
  }

  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    // Obtener metadata del episodio desde Plex
    const episodeUrl = `${baseURI}/library/metadata/${episodeRatingKey}?X-Plex-Token=${accessToken}`;
    const xmlData = await httpsGetXML(episodeUrl);
    const episodeData = parseXML(xmlData);

    if (!episodeData || !episodeData.MediaContainer || !episodeData.MediaContainer.Metadata || episodeData.MediaContainer.Metadata.length === 0) {
      return res.status(404).send('No se encontró información del episodio');
    }

    // Extraer libraryKey y libraryTitle del MediaContainer si no se proporcionaron
    if (!libraryKey && episodeData.MediaContainer.librarySectionID) {
      libraryKey = episodeData.MediaContainer.librarySectionID;
      console.log('[/episode] libraryKey extraído del XML:', libraryKey);
    }
    if (!libraryTitle && episodeData.MediaContainer.librarySectionTitle) {
      libraryTitle = episodeData.MediaContainer.librarySectionTitle;
      console.log('[/episode] libraryTitle extraído del XML:', libraryTitle);
    }

    const metadataEntries = episodeData.MediaContainer.Metadata;
    
    // La petición a /library/metadata/{ratingKey} SIEMPRE devuelve solo el episodio específico
    // No necesitamos buscar, el primer (y único) elemento ES el episodio que pedimos
    const episode = metadataEntries[0];
    
    if (!episode) {
      return res.status(404).send('No se encontró información del episodio solicitado');
    }
    
    // Extraer información del episodio
    const episodeTitle = episode.title || 'Sin título';
    const episodeSummary = episode.summary || 'Sin descripción disponible';
    const episodeThumb = episode.thumb ? `${baseURI}${episode.thumb}?X-Plex-Token=${accessToken}` : '';
    const episodeYear = episode.year || episode.originallyAvailableAt?.split('-')[0] || '';
    const episodeRating = episode.rating ? parseFloat(episode.rating).toFixed(1) : '';
    const episodeDuration = episode.duration ? Math.round(episode.duration / 60000) : '';
    const finalSeriesTitle = episode.grandparentTitle || seriesTitle || 'Serie';
    const finalSeasonNumber = episode.parentIndex || seasonNumber || '';
    const finalEpisodeNumber = episode.index || episodeNumber || '';
    
    // Extraer información técnica del archivo
    let fileSize = '';
    let quality = '';
    let videoCodec = '';
    let audioCodec = '';
    let resolution = '';
    let bitrate = '';
    let fileName = '';
    let downloadUrl = '';
    
    if (episode.Media && episode.Media[0]) {
      const media = episode.Media[0];
      const part = media.Part && media.Part[0] ? media.Part[0] : null;
      
      if (part) {
        const fileSizeBytes = parseInt(part.size || '0', 10);
        if (fileSizeBytes > 0) {
          const gb = fileSizeBytes / (1024 * 1024 * 1024);
          fileSize = gb >= 1 ? gb.toFixed(2) + ' GB' : (gb * 1024).toFixed(2) + ' MB';
        }
        
        const partKey = part.key || '';
        const fileFull = part.file || '';
        fileName = fileFull.split('/').pop();
        
        // Decodificar entidades HTML en el nombre del archivo
        const decodedFileName = fileName
          .replace(/&#191;/g, '¿')
          .replace(/&#233;/g, 'é')
          .replace(/&#225;/g, 'á')
          .replace(/&#237;/g, 'í')
          .replace(/&#243;/g, 'ó')
          .replace(/&#250;/g, 'ú')
          .replace(/&#241;/g, 'ñ')
          .replace(/&#193;/g, 'Á')
          .replace(/&#201;/g, 'É')
          .replace(/&#205;/g, 'Í')
          .replace(/&#211;/g, 'Ó')
          .replace(/&#218;/g, 'Ú')
          .replace(/&#209;/g, 'Ñ')
          .replace(/&#161;/g, '¡')
          .replace(/&#63;/g, '?')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'");
        
        fileName = decodedFileName;
        const keyBase = partKey.replace(/\/[^\/]+$/, '/');
        // Codificar el nombre del archivo para la URL
        const encodedFileName = encodeURIComponent(decodedFileName);
        downloadUrl = `${baseURI}${keyBase}${encodedFileName}?download=0&X-Plex-Token=${accessToken}`;
      }
      
      videoCodec = media.videoCodec || '';
      audioCodec = media.audioCodec || '';
      resolution = media.videoResolution ? `${media.videoResolution}p` : '';
      bitrate = media.bitrate ? `${Math.round(media.bitrate / 1000)} Mbps` : '';
      
      // Determinar calidad basada en resolución
      if (resolution) {
        const resValue = parseInt(media.videoResolution);
        if (resValue >= 2160) quality = '4K';
        else if (resValue >= 1080) quality = 'Full HD';
        else if (resValue >= 720) quality = 'HD';
        else quality = 'SD';
      }
    }
    
    // Obtener información adicional de TMDB si está disponible
    let tmdbEpisodeData = null;
    let tmdbEpisodeImage = '';
    let imdbUrl = '';
    let youtubeTrailerUrl = '';
    
    // VERSION 2.0 - Usar SIEMPRE los datos de Plex para título y descripción (son más confiables)
    const displayTitle = episodeTitle;
    const displayDescription = episodeSummary;
    
    if (tmdbId && finalSeasonNumber && finalEpisodeNumber) {
      try {
        const tmdbEpisodeUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${finalSeasonNumber}/episode/${finalEpisodeNumber}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=external_ids,videos`;
        tmdbEpisodeData = await httpsGet(tmdbEpisodeUrl);
        
        if (tmdbEpisodeData) {
          // Solo usar imagen de TMDB
          if (tmdbEpisodeData.still_path) {
            tmdbEpisodeImage = `https://image.tmdb.org/t/p/original${tmdbEpisodeData.still_path}`;
          }
          
          // IMDB ID
          if (tmdbEpisodeData.external_ids && tmdbEpisodeData.external_ids.imdb_id) {
            imdbUrl = `https://www.imdb.com/title/${tmdbEpisodeData.external_ids.imdb_id}`;
          } else if (imdbId) {
            imdbUrl = `https://www.imdb.com/title/${imdbId}`;
          }
          
          // YouTube trailer
          if (tmdbEpisodeData.videos && tmdbEpisodeData.videos.results && tmdbEpisodeData.videos.results.length > 0) {
            const trailer = tmdbEpisodeData.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
            if (trailer) {
              youtubeTrailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
            }
          }
        }
      } catch (err) {
        console.error('Error al obtener datos de TMDB para el episodio:', err);
      }
    }
    
    const displayPoster = tmdbEpisodeImage || episodeThumb;

    const tmdbUrl = tmdbId ? `https://www.themoviedb.org/tv/${tmdbId}/season/${finalSeasonNumber}/episode/${finalEpisodeNumber}` : '';
    const backToSeasonUrl = seasonRatingKey ? `/list?seasonRatingKey=${seasonRatingKey}&accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&seasonNumber=${finalSeasonNumber}&seriesTitle=${encodeURIComponent(finalSeriesTitle)}${tmdbId ? '&tmdbId=' + tmdbId : ''}${parentRatingKey ? '&parentRatingKey=' + parentRatingKey : ''}${libraryKey ? '&libraryKey=' + encodeURIComponent(libraryKey) : ''}${libraryTitle ? '&libraryTitle=' + encodeURIComponent(libraryTitle) : ''}` : '';

    // Obtener backdrop de la serie desde TMDB
    let seriesBackdrop = '';
    if (tmdbId) {
      try {
        const seriesData = await httpsGet(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`);
        if (seriesData && seriesData.backdrop_path) {
          seriesBackdrop = `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}`;
        }
      } catch (err) {
        console.error('Error al obtener backdrop de la serie:', err);
      }
    }

    // Generar HTML de la página del episodio
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${finalSeriesTitle} - S${finalSeasonNumber}E${finalEpisodeNumber} - Infinity Scrap</title>
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
          color: #e5e5e5;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 998;
          cursor: pointer;
        }
        
        .episode-container {
          background: #282828;
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
          z-index: 999;
        }
        
        .episode-container::-webkit-scrollbar {
          width: 8px;
        }
        
        .episode-container::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .episode-container::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        .modal-backdrop-header {
          position: relative;
          background-size: cover;
          background-position: center top;
          background-repeat: no-repeat;
          background-image: url('${seriesBackdrop}');
          min-height: 250px;
          display: flex;
          align-items: flex-end;
          padding: 2.5rem 3.5rem 1.5rem 3.5rem;
          border-radius: 12px 12px 0 0;
        }
        
        .modal-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(40, 40, 40, 0.3) 0%,
            rgba(40, 40, 40, 0.7) 50%,
            #282828 100%
          );
          border-radius: 12px 12px 0 0;
        }
        
        .modal-header-content {
          position: relative;
          z-index: 1;
          width: 100%;
        }
        
        .series-title {
          font-size: 3rem;
          font-weight: 700;
          color: white;
          margin-bottom: 0.5rem;
          text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9);
          line-height: 1.1;
        }
        
        .episode-title {
          display: none;
        }
        
        .modal-badges-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .modal-icons-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-left: auto;
        }
        
        .episode-identifier {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .badge-icon-link {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }
        
        .badge-icon-link:hover {
          transform: scale(1.1);
        }
        
        .badge-icon {
          height: 32px;
          width: 32px;
          object-fit: contain;
        }
        
        .modal-hero {
          padding: 2rem 3.5rem;
          display: flex;
          gap: 2rem;
        }
        
        .modal-poster-container {
          flex-shrink: 0;
          width: 40%;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .modal-poster-hero {
          width: 100%;
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        
        .modal-poster-hero img {
          width: 100%;
          aspect-ratio: 16/9;
          object-fit: cover;
          display: block;
        }
        
        .modal-main-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .synopsis-container {
          position: relative;
        }
        
        .modal-synopsis {
          line-height: 1.7;
          font-size: 1.08rem;
          text-align: justify;
          margin-bottom: 0;
          color: #cccccc;
          max-height: 6.8em;
          overflow: hidden;
          transition: max-height 0.3s ease;
          position: relative;
          padding-right: 0;
        }
        
        .modal-synopsis.expanded {
          max-height: none;
        }
        
        .modal-synopsis::after {
          content: '...';
          position: absolute;
          bottom: 0;
          right: 1.2rem;
          background: linear-gradient(to right, transparent 0%, #282828 25%, #282828 100%);
          color: #cccccc;
          width: 2.2rem;
          text-align: right;
        }
        
        .modal-synopsis.expanded::after {
          content: '';
          display: none;
        }
        
        .synopsis-toggle {
          position: absolute;
          bottom: 0;
          right: 0;
          background: #282828;
          border: none;
          color: #e5a00d;
          font-size: 1.3rem;
          font-weight: bold;
          cursor: pointer;
          padding: 0 0.25rem;
          transition: transform 0.2s ease;
          line-height: 1.7;
          z-index: 2;
        }
        
        .synopsis-toggle:hover {
          transform: scale(1.15);
          color: #f0b825;
        }
        
        .tag {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .rating-badge {
          background: rgba(249, 168, 37, 0.2);
          border: 2px solid #f9a825;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #f9a825;
          font-weight: 600;
        }
        
        .btn {
          padding: 0.8rem 1.5rem;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .btn-primary {
          background: #e5a00d;
          color: #000;
        }
        
        .btn-primary:hover {
          background: #f0b825;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(229, 160, 13, 0.4);
        }
        
        .btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #e5e5e5;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(229, 160, 13, 0.5);
        }
        
        .episode-info-card {
          background: rgba(255, 255, 255, 0.07);
          border-radius: 16px;
          padding: 1rem;
          margin-bottom: 1rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          flex: 1;
        }
        
        .episode-description {
          color: #d5d5d5;
          font-size: 1.05rem;
          line-height: 1.6;
          text-align: justify;
          max-height: 5.1em;
          overflow: hidden;
          position: relative;
          transition: max-height 0.3s ease;
          margin-bottom: 0;
        }
        
        .episode-description.expanded {
          max-height: none;
        }
        
        .description-toggle {
          background: transparent;
          border: none;
          color: #e5a00d;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          margin-top: 0.75rem;
          transition: color 0.2s;
          display: none;
          text-decoration: underline;
        }
        
        .description-toggle:hover {
          color: #f0b825;
        }
        
        .info-card-title {
          font-size: 1.6rem;
          font-weight: 700;
          color: #e5a00d;
          margin-bottom: 2rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          border-bottom: 2px solid rgba(229, 160, 13, 0.3);
          padding-bottom: 1rem;
        }
        
        .info-row {
          margin-bottom: 1.8rem;
          padding: 1rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          transition: all 0.3s ease;
        }
        
        .info-row:hover {
          background: rgba(0, 0, 0, 0.3);
          transform: translateX(5px);
        }
        
        .info-row:last-child {
          margin-bottom: 0;
        }
        
        .info-label {
          color: #e5a00d;
          font-weight: 700;
          font-size: 0.85rem;
          margin-bottom: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .info-label::before {
          content: '▸';
          color: #e5a00d;
          font-size: 1.2rem;
        }
        
        .info-value {
          color: #e5e5e5;
          font-size: 1.05rem;
          line-height: 1.7;
          padding-left: 1.5rem;
        }
        
        .episode-description {
          color: #d5d5d5;
          font-size: 1.05rem;
          line-height: 1.8;
          text-align: justify;
        }
        
        .file-info {
          background: rgba(0, 0, 0, 0.3);
          padding: 1rem 2.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .technical-details {
          max-width: 800px;
          margin: 0 auto;
        }
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: all 0.2s;
          width: 100%;
          text-align: center;
          display: block;
        }
        
        .technical-toggle:hover {
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 500px;
          margin-top: 16px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .info-table td {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.85rem;
        }
        
        .info-table td.label {
          color: #888;
          font-weight: 500;
          width: 35%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          word-break: break-all;
        }
        
        @media (max-width: 768px) {
          .modal-hero {
            flex-direction: column;
            padding: 1.5rem;
          }
          
          .modal-poster-container {
            width: 100%;
          }
          
          .modal-poster-hero {
            width: 100%;
            max-width: 400px;
            margin: 0 auto;
          }
          
          .modal-main-info {
            width: 100%;
          }
          
          .modal-backdrop-header {
            padding: 2rem 1.5rem 1rem;
          }
          
          .series-title {
            font-size: 2rem !important;
          }
          
          .modal-badges-container {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          
          .modal-icons-row {
            margin-left: 0;
          }
          
          .episode-info-card {
            padding: 1.5rem;
          }
          
          .info-row {
            flex-direction: column;
            gap: 0.3rem;
          }
        }
      </style>
    </head>
    <body>
      <div class="modal-overlay" onclick="window.location.href='${backToSeasonUrl}'"></div>
      <div class="episode-container">
        <!-- Header con backdrop -->
        <div class="modal-backdrop-header">
          <div class="modal-backdrop-overlay"></div>
          <div class="modal-header-content">
            <h1 class="series-title">${finalSeriesTitle}</h1>
            <div class="modal-badges-container">
              <div class="modal-badges-row">
                ${episodeYear ? `<span class="tag">${episodeYear}</span>` : ''}
                ${quality ? `<span class="tag">${quality}</span>` : ''}
                ${episodeDuration ? `<span class="tag">${episodeDuration} min</span>` : ''}
                ${fileSize ? `<span class="tag">${fileSize}</span>` : ''}
                ${episodeRating ? `<div class="rating-badge">⭐ ${episodeRating}</div>` : ''}
              </div>
              <div class="modal-icons-row">
                ${tmdbUrl ? `
                  <a href="${tmdbUrl}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" class="badge-icon">
                  </a>
                ` : ''}
                ${imdbUrl ? `
                  <a href="${imdbUrl}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" class="badge-icon">
                  </a>
                ` : ''}
                ${youtubeTrailerUrl ? `
                  <a href="${youtubeTrailerUrl}" target="_blank" rel="noopener noreferrer" title="Ver trailer" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" class="badge-icon">
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Hero con poster e info -->
        <div class="modal-hero">
          <div class="modal-poster-container">
            <div class="modal-poster-hero">
              ${displayPoster ? `<img loading="lazy" src="${displayPoster}" alt="${episodeTitle}" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg';">` : `<img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg" alt="Sin poster">`}
            </div>
            <button class="btn btn-primary" style="width: 100%;" onclick="downloadEpisode()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
              Descargar Capítulo
            </button>
          </div>
          
          <div class="modal-main-info">
            <div class="episode-info-card">
              <h2 style="font-size: 1.3rem; font-weight: 700; color: #e5a00d; margin-bottom: 1rem;">
                Temporada ${finalSeasonNumber} - Capítulo ${finalEpisodeNumber}
              </h2>
              
              <h3 style="font-size: 1.15rem; font-weight: 600; color: #ffffff; margin-bottom: 0.8rem;">
                ${displayTitle}
              </h3>
              
              <div class="episode-description" id="episodeDescription">
                ${displayDescription}
              </div>
              <button class="description-toggle" id="descriptionToggle" onclick="toggleDescription()">
                Ver más
              </button>
            </div>
            ${backToSeasonUrl ? `<a href="${backToSeasonUrl}" class="btn btn-secondary" style="width: 100%;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.828 11H20v2H7.828l5.364 5.364-1.414 1.414L4 12l7.778-7.778 1.414 1.414z"/>
              </svg>
              Volver a Temporada
            </a>` : ''}
          </div>
        </div>
        
        <!-- Info del archivo -->
        <div class="file-info">
          <div class="technical-details">
            <button class="technical-toggle" onclick="toggleTechnical()">
              ▶ Mostrar detalles técnicos
            </button>
            <div class="technical-content" id="technicalContent">
              <table class="info-table">
                ${fileName ? `<tr><td class="label">Archivo</td><td class="value">${fileName}</td></tr>` : ''}
                ${fileSize ? `<tr><td class="label">Tamaño</td><td class="value">${fileSize}</td></tr>` : ''}
                ${resolution ? `<tr><td class="label">Resolución</td><td class="value">${resolution}</td></tr>` : ''}
                ${videoCodec ? `<tr><td class="label">Códec de Video</td><td class="value">${videoCodec.toUpperCase()}</td></tr>` : ''}
                ${audioCodec ? `<tr><td class="label">Códec de Audio</td><td class="value">${audioCodec.toUpperCase()}</td></tr>` : ''}
                ${bitrate ? `<tr><td class="label">Bitrate</td><td class="value">${bitrate}</td></tr>` : ''}
              </table>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        function toggleTechnical() {
          const content = document.getElementById('technicalContent');
          const button = document.querySelector('.technical-toggle');
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') ? '▼ Ocultar detalles técnicos' : '▶ Mostrar detalles técnicos';
        }
        
        function toggleDescription() {
          const description = document.getElementById('episodeDescription');
          const button = document.getElementById('descriptionToggle');
          description.classList.toggle('expanded');
          button.textContent = description.classList.contains('expanded') ? 'Ver menos' : 'Ver más';
        }
        
        // Detectar si la descripción necesita "Ver más"
        window.addEventListener('load', function() {
          const description = document.getElementById('episodeDescription');
          const button = document.getElementById('descriptionToggle');
          if (description && button) {
            // Añadir margen de 15px para ignorar descendentes de letras (g, j, p, q, y)
            if (description.scrollHeight > description.clientHeight + 15) {
              button.style.display = 'inline-block';
            }
          }
        });
        
        function downloadEpisode() {
          // Descargar directamente usando la URL de Plex (igual que en /list)
          const downloadUrl = '${downloadUrl}';
          if (downloadUrl) {
            window.location.href = downloadUrl;
          }
        }
      </script>
    </body>
    </html>
    `);
  } catch (error) {
    console.error('Error al procesar episodio:', error);
    res.status(500).send('Error al obtener información del episodio: ' + error.message);
  }
});

app.get('/list', async (req, res) => {
  const downloadsParam = req.query.downloads;
  const seasonRatingKey = req.query.seasonRatingKey;
  const accessToken = req.query.accessToken;
  const baseURI = req.query.baseURI;
  const seasonNumber = req.query.seasonNumber;
  const seriesTitleParam = req.query.seriesTitle;
  const tmdbId = req.query.tmdbId;
  const parentRatingKey = req.query.parentRatingKey;
  let libraryKey = req.query.libraryKey || '';
  let libraryTitle = req.query.libraryTitle || '';
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  
  // console.log('[/list] libraryKey recibido:', libraryKey);
  // console.log('[/list] libraryTitle recibido:', libraryTitle);
  
  let downloads = [];
  
  // Si recibimos seasonRatingKey, obtener episodios de Plex
  if (seasonRatingKey && accessToken && baseURI) {
    try {
      const seasonUrl = `${baseURI}/library/metadata/${seasonRatingKey}/children?X-Plex-Token=${accessToken}`;
      const xmlData = await httpsGetXML(seasonUrl);
      const seasonData = parseXML(xmlData);
      
      // Extraer libraryKey y libraryTitle del MediaContainer si no se proporcionaron
      if (!libraryKey && seasonData.MediaContainer.librarySectionID) {
        libraryKey = seasonData.MediaContainer.librarySectionID;
        console.log('[/list] libraryKey extraído del XML:', libraryKey);
      }
      if (!libraryTitle && seasonData.MediaContainer.librarySectionTitle) {
        libraryTitle = seasonData.MediaContainer.librarySectionTitle;
        console.log('[/list] libraryTitle extraído del XML:', libraryTitle);
      }
      
      if (seasonData && seasonData.MediaContainer && seasonData.MediaContainer.Metadata) {
        const episodes = seasonData.MediaContainer.Metadata;
        
        // Construir array de downloads con la información de cada episodio
        downloads = episodes.map(ep => {
          let fileUrl = null;
          let fileSize = 0;
          let fileName = '';
          let partKey = '';
          
          if (ep.Media && ep.Media[0] && ep.Media[0].Part && ep.Media[0].Part[0]) {
            const part = ep.Media[0].Part[0];
            fileName = part.file ? part.file.split('/').pop() : '';
            fileSize = parseInt(part.size) || 0;
            partKey = part.key || '';
            // Codificar el nombre del archivo para la URL
            const encodedFileName = encodeURIComponent(fileName);
            // Reemplazar /file.mkv con el nombre real del archivo
            const keyWithoutFile = part.key.replace(/\/[^\/]+$/, '');
            fileUrl = `${baseURI}${keyWithoutFile}/${encodedFileName}?download=0&X-Plex-Token=${accessToken}`;
          }
          
          // Formatear tamaño de archivo
          let fileSizeFormatted = 'N/A';
          if (fileSize > 0) {
            const gb = fileSize / (1024 * 1024 * 1024);
            const mb = fileSize / (1024 * 1024);
            fileSizeFormatted = gb >= 1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
          }
          
          // Decodificar entidades HTML en el nombre de archivo
          const decodedFileName = fileName
            .replace(/&#191;/g, '¿')
            .replace(/&#233;/g, 'é')
            .replace(/&#225;/g, 'á')
            .replace(/&#237;/g, 'í')
            .replace(/&#243;/g, 'ó')
            .replace(/&#250;/g, 'ú')
            .replace(/&#241;/g, 'ñ')
            .replace(/&#193;/g, 'Á')
            .replace(/&#201;/g, 'É')
            .replace(/&#205;/g, 'Í')
            .replace(/&#211;/g, 'Ó')
            .replace(/&#218;/g, 'Ú')
            .replace(/&#209;/g, 'Ñ')
            .replace(/&#161;/g, '¡')
            .replace(/&#63;/g, '?')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'");
          
          return {
            episodeTitle: ep.title || '',
            episodeNumber: parseInt(ep.index) || 0,
            seasonNumber: parseInt(seasonNumber) || parseInt(ep.parentIndex) || 0,
            url: fileUrl,
            fileName: decodedFileName,
            fileSize: fileSize,
            fileSizeFormatted: fileSizeFormatted,
            posterUrl: ep.thumb ? `${baseURI}${ep.thumb}?X-Plex-Token=${accessToken}` : null,
            summary: ep.summary || '',
            accessToken: accessToken,
            partKey: encodeURIComponent(partKey),
            baseURI: baseURI,
            ratingKey: ep.ratingKey || '',
            parentRatingKey: ep.parentRatingKey || seasonRatingKey,
            grandparentRatingKey: ep.grandparentRatingKey || parentRatingKey
          };
        });
        
        // Agregar información de la temporada al inicio
        if (downloads.length > 0) {
          downloads.unshift({
            isSeasonInfo: true,
            seriesTitle: seriesTitleParam || '',
            seasonTitle: `Temporada ${seasonNumber}`,
            seasonNumber: parseInt(seasonNumber) || 0,
            seasonSummary: '',
            seasonYear: '',
            seasonPoster: '',
            tmdbId: tmdbId || null
          });
        }
      }
    } catch (error) {
      console.error('Error fetching season data from Plex:', error);
      return res.status(500).send('Error fetching season data');
    }
  }
  // Si recibimos downloads directamente
  else if (downloadsParam) {
    try {
      downloads = JSON.parse(downloadsParam);
    } catch (e) {
      return res.status(400).send('Invalid downloads format');
    }
  }
  // Si no tenemos ninguno de los dos
  else {
    return res.status(400).send('No downloads or season data provided');
  }
  
  if (!Array.isArray(downloads) || downloads.length === 0) {
    return res.status(400).send('No downloads found');
  }
  
  // Separar información de temporada de los episodios
  let seasonInfo = null;
  let episodes = downloads;
  
  if (downloads[0] && downloads[0].isSeasonInfo) {
    seasonInfo = downloads[0];
    episodes = downloads.slice(1);
  }
  
  // Mostrar todos los episodios
  const totalEpisodes = episodes.length;
  const startIndex = 0;
  const endIndex = totalEpisodes;
  const currentPageEpisodes = episodes;
  
  // Calcular tamaño total de la temporada
  const totalSizeBytes = episodes.reduce((sum, ep) => sum + (ep.fileSize || 0), 0);
  const totalSizeGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
  const totalSizeTB = (totalSizeBytes / (1024 * 1024 * 1024 * 1024)).toFixed(2);
  const totalSizeFormatted = totalSizeBytes >= 1024 * 1024 * 1024 * 1024 
    ? `${totalSizeTB} TB` 
    : `${totalSizeGB} GB`;
  
  // Obtener información de la serie/temporada
  const firstEpisode = episodes[0];
  let seriesTitle = seasonInfo && seasonInfo.seriesTitle ? seasonInfo.seriesTitle : (seasonInfo ? seasonInfo.seasonTitle : (firstEpisode.title || 'Contenido'));
  const seasonNumberFromEpisode = firstEpisode.seasonNumber || seasonInfo?.seasonNumber || '';
  let seasonSummary = seasonInfo ? seasonInfo.seasonSummary : '';
  let seasonYear = seasonInfo ? seasonInfo.seasonYear : '';
  let seasonPoster = seasonInfo ? seasonInfo.seasonPoster : (firstEpisode.posterUrl || '');
  let backdropPath = null;
  let imdbId = null;
  let trailerKey = null;
  
  // Intentar mejorar datos con TMDB
  let tmdbIdToUse = (seasonInfo && seasonInfo.tmdbId) || tmdbId || null;
  
  // Si no hay tmdbId pero hay título de serie, buscar en TMDB
  if (!tmdbIdToUse && seriesTitle) {
    try {
      const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(seriesTitle)}&language=es-ES`;
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();
      
      if (searchData.results && searchData.results.length > 0) {
        tmdbIdToUse = searchData.results[0].id;
        console.log(`✅ TMDB ID encontrado para "${seriesTitle}": ${tmdbIdToUse}`);
      }
    } catch (error) {
      console.error('Error buscando serie en TMDB:', error);
    }
  }
  
  // Obtener datos de TMDB si disponible
  if (tmdbIdToUse) {
    try {
      // Obtener datos completos de la serie
      const seriesData = await fetchTMDBSeriesData(tmdbIdToUse);
      
      // Obtener datos específicos de la temporada
      const seasonData = await fetchTMDBSeasonData(tmdbIdToUse, seasonNumberFromEpisode);
      
      if (seasonData && seasonData.overview) {
        seasonSummary = seasonData.overview;
      } else if (seriesData && seriesData.overview && !seasonSummary) {
        seasonSummary = seriesData.overview;
      }
      
      if (seasonData && seasonData.posterPath) {
        seasonPoster = seasonData.posterPath;
      } else if (seriesData && seriesData.posterPath && (!seasonPoster || seasonPoster.includes('thumb'))) {
        seasonPoster = seriesData.posterPath;
      }
      
      if (seriesData && seriesData.year && !seasonYear) {
        seasonYear = seriesData.year.toString();
      }
      
      // Obtener backdrop, IMDB ID y trailer de la serie
      if (seriesData) {
        backdropPath = seriesData.backdropPath;
        imdbId = seriesData.imdbId;
        trailerKey = seriesData.trailerKey;
      }
      
      // Actualizar el tmdbId en seasonInfo para uso posterior
      if (seasonInfo) {
        seasonInfo.tmdbId = tmdbIdToUse;
      }
    } catch (error) {
      console.error('Error fetching TMDB data:', error);
    }
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${seriesTitle}${seasonNumberFromEpisode ? ` - Temporada ${seasonNumberFromEpisode}` : ''} - Infinity Scrap</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
          color: #e5e5e5;
          min-height: 100vh;
          padding: 20px;
        }
        
        .hero-background {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 400px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.95) 100%),
                      ${seasonPoster ? `url('${seasonPoster}')` : 'linear-gradient(135deg, #e5a00d 0%, #cc8800 100%)'};
          background-size: cover;
          background-position: center top;
          filter: blur(20px);
          opacity: 0.4;
          z-index: 0;
        }
        
        .container {
          position: relative;
          max-width: 1200px;
          margin: 0 auto;
          z-index: 1;
        }
        
        .header {
          text-align: center;
          padding: 20px 0 40px 0;
        }
        
        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        
        .logo-icon {
          width: 40px;
          height: 40px;
          background: #e5a00d;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 24px;
          color: #000;
        }
        
        .logo-text {
          font-size: 1.8rem;
          font-weight: 700;
          color: #e5a00d;
        }
        
        .series-header {
          position: relative;
          width: 100%;
          min-height: 480px;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          background-color: #000;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          margin-bottom: 32px;
          border-radius: 0;
        }
        
        .series-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.75) 30%, rgba(0,0,0,0.95) 70%, rgba(0,0,0,0.98) 100%);
          z-index: 1;
        }
        
        .series-header-overlay {
          position: relative;
          z-index: 5;
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 2rem;
          padding-bottom: 0;
        }
        
        .series-titles {
          margin-bottom: 2rem;
        }
        
        .series-poster {
          width: 100%;
          aspect-ratio: 2/3;
          border-radius: 12px;
          object-fit: cover;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
          align-self: start;
        }
        
        .series-titles h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin: 0;
          color: #fff;
          text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.8);
        }
        
        .series-titles h2 {
          font-size: 1.5rem;
          font-weight: 400;
          font-style: italic;
          margin: 0.5rem 0 0 0;
          color: rgba(255, 255, 255, 0.9);
          text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.8);
        }
        
        .series-content {
          display: grid;
          grid-template-columns: 200px 1fr;
          gap: 2rem;
          flex: 1;
        }
        
        .series-info {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .series-meta {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .meta-badge {
          background: rgba(229, 160, 13, 0.15);
          border: 1px solid rgba(229, 160, 13, 0.3);
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #e5a00d;
        }
        
        .episodes-count-badge {
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          padding: 0.5rem 1.25rem;
          border-radius: 25px;
          font-size: 0.95rem;
          font-weight: 700;
          box-shadow: 0 2px 8px rgba(229, 160, 13, 0.3);
        }
        
        .series-genres {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }
        
        .genre-tag {
          background: rgba(229, 160, 13, 0.15);
          border: 1px solid rgba(229, 160, 13, 0.3);
          padding: 0.4rem 1rem;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: 600;
          color: #e5a00d;
          transition: all 0.2s ease;
        }
        
        .genre-tag:hover {
          background: rgba(229, 160, 13, 0.25);
          border-color: rgba(229, 160, 13, 0.5);
        }
        
        .series-description {
          color: #bbb;
          font-size: 1rem;
          line-height: 1.6;
          transition: max-height 0.3s ease;
        }
        
        .series-description.collapsed {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        .description-text {
          transition: all 0.3s ease;
        }
        
        .expand-description-btn {
          background: transparent;
          border: none;
          color: #e5a00d;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          align-self: flex-start;
          transition: opacity 0.2s;
          margin-top: 0.5rem;
        }
        
        .expand-description-btn:hover {
          opacity: 0.8;
        }
        
        .action-buttons {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: auto;
        }
        
        .download-season-btn, .download-page-btn {
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          border: none;
          border-radius: 12px;
          padding: 0.75rem 1.5rem;
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3);
          width: 100%;
        }
        
        .download-page-btn {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          color: #fff;
          box-shadow: 0 4px 16px rgba(37, 99, 235, 0.3);
        }
        
        .download-season-btn:hover, .download-page-btn:hover {
          transform: translateY(-2px);
        }
        
        .download-season-btn:hover {
          box-shadow: 0 6px 24px rgba(229, 160, 13, 0.5);
        }
        
        .download-page-btn:hover {
          box-shadow: 0 6px 24px rgba(37, 99, 235, 0.5);
        }
        
        .download-season-btn i, .download-page-btn i {
          font-size: 1.25rem;
        }
        
        .download-season-btn:disabled, .download-page-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        
        .download-season-btn svg, .download-page-btn svg {
          width: 24px;
          height: 24px;
        }
        
        .episodes-grid {
          display: grid;
          gap: 20px;
          margin-bottom: 32px;
        }
        
        .episode-card {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.3s ease;
          display: grid;
          grid-template-columns: 200px 1fr auto;
          gap: 24px;
          align-items: flex-start;
          padding: 16px;
          position: relative;
        }
        
        .episode-card:hover {
          border-color: rgba(229, 160, 13, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        
        .episode-poster {
          width: 100%;
          border-radius: 8px;
          aspect-ratio: 16/9;
          object-fit: cover;
          position: sticky;
          top: 0;
        }
        
        .episode-info {
          flex: 1;
        }
        
        .episode-number {
          font-size: 0.85rem;
          color: #e5a00d;
          font-weight: 600;
          margin-bottom: 8px;
        }
        
        .episode-title {
          font-size: 1.3rem;
          font-weight: 600;
          color: #fff;
          margin-bottom: 8px;
        }
        
        .episode-meta {
          display: flex;
          gap: 16px;
          font-size: 0.85rem;
          color: #888;
          margin-bottom: 12px;
        }
        
        .episode-meta span {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .download-btn {
          padding: 12px 24px;
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        
        .download-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(229, 160, 13, 0.4);
        }
        
        .download-btn svg {
          width: 20px;
          height: 20px;
        }
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8rem;
          transition: all 0.2s;
          margin-top: 8px;
          width: 100%;
          text-align: left;
        }
        
        .technical-toggle:hover {
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 500px;
          margin-top: 12px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        
        .info-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .info-table td.label {
          color: #888;
          font-weight: 600;
          width: 30%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.75rem;
          word-break: break-all;
        }
        
        .filename-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .filename-text {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: all 0.3s ease;
        }
        
        .filename-text.expanded {
          white-space: normal;
          word-break: break-word;
        }
        
        .expand-btn {
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          color: #e5a00d;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.7rem;
          transition: all 0.2s;
          min-width: 60px;
          text-align: center;
        }
        
        .expand-btn:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .filename-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .expand-btn-meta {
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          color: #e5a00d;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.7rem;
          transition: all 0.2s;
          min-width: 20px;
          height: 20px;
          text-align: center;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .expand-btn-meta:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .pagination-controls {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 32px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .breadcrumbs {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          font-size: 0.9rem;
          color: #888;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .breadcrumbs .current {
          color: #e5a00d;
          font-weight: 600;
        }
        
        .pagination-nav {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .page-btn {
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #ccc;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .page-btn:hover {
          background: rgba(229, 160, 13, 0.15);
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .page-btn.current {
          background: rgba(229, 160, 13, 0.2);
          border-color: rgba(229, 160, 13, 0.4);
          color: #e5a00d;
          font-weight: 600;
        }
        
        .page-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .episode-jump {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        
        .episode-jump input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 8px 12px;
          color: #fff;
          font-size: 0.9rem;
          width: 80px;
          text-align: center;
        }
        
        .episode-jump button {
          padding: 8px 16px;
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          border-radius: 6px;
          color: #e5a00d;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }
        
        .episode-jump button:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .progress-indicator {
          margin-top: 16px;
          padding: 12px;
          background: rgba(229, 160, 13, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(229, 160, 13, 0.2);
          display: none;
        }
        
        .progress-indicator.show {
          display: block;
        }
        
        .progress-text {
          color: #e5a00d;
          font-size: 0.9rem;
          margin-bottom: 8px;
        }
        
        .progress-bar {
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: #e5a00d;
          width: 0%;
          transition: width 0.3s ease;
        }
        
        @media (max-width: 968px) {
          .series-header {
            min-height: 400px;
          }
          
          .series-header-overlay {
            padding: 1.5rem;
          }
          
          .series-titles h1 {
            font-size: 2rem;
          }
          
          .series-titles h2 {
            font-size: 1.2rem;
          }
          
          .series-content {
            grid-template-columns: 1fr;
            text-align: center;
          }
          
          .series-poster {
            max-width: 250px;
            margin: 0 auto;
          }
          
          .series-meta, .action-buttons, .series-genres {
            justify-content: center;
            flex-wrap: wrap;
          }
          
          .pagination-controls {
            padding: 16px;
          }
          
          .pagination-nav {
            flex-wrap: wrap;
            gap: 8px;
          }
          
          .page-btn {
            font-size: 0.8rem;
            padding: 8px 12px;
          }
          
          .breadcrumbs {
            font-size: 0.8rem;
            text-align: center;
          }
          
          .episode-jump {
            flex-direction: column;
            gap: 8px;
            text-align: center;
          }
          
          .episode-jump input, .episode-jump button {
            width: 120px;
          }
          
          .episode-card {
            grid-template-columns: 1fr;
            text-align: center;
            padding: 12px;
          }
          
          .episode-poster {
            max-width: 250px;
            margin: 0 auto;
          }
          
          .episode-meta {
            justify-content: center;
          }
          
          .download-btn {
            width: 100%;
            max-width: 200px;
            justify-content: center;
            margin: 0 auto;
          }
        }
        
        @media (max-width: 640px) {
          .container {
            padding: 10px;
          }
          
          .series-header {
            min-height: 350px;
          }
          
          .series-header-overlay {
            padding: 1rem;
          }
          
          .series-titles h1 {
            font-size: 1.5rem;
          }
          
          .series-titles h2 {
            font-size: 1rem;
          }
          
          .pagination-nav {
            justify-content: center;
          }
          
          .page-btn {
            padding: 6px 10px;
            font-size: 0.75rem;
          }
          
          .episode-card {
            padding: 8px;
          }
          
          .episode-title {
            font-size: 1.1rem;
          }
          
          .meta-badge, .episodes-count-badge {
            font-size: 0.8rem;
            padding: 0.4rem 0.8rem;
          }
          
          .download-season-btn, .download-page-btn {
            font-size: 0.9rem;
            padding: 0.65rem 1.25rem;
          }
        }
      </style>
      <script>
        const allEpisodes = ${JSON.stringify(episodes)};
        let displayedEpisodes = [];
        let currentIndex = 0;
        const episodesPerLoad = 20;
        const totalEpisodes = allEpisodes.length;
        const libraryKey = '${libraryKey}';
        const libraryTitle = '${libraryTitle}';
        
        // Función para cerrar el modal y volver a la serie
        function closeModal() {
          // Redirigir a /series-redirect para obtener todos los datos de la serie
          const params = new URLSearchParams();
          params.set('accessToken', '${accessToken}');
          params.set('baseURI', '${baseURI}');
          params.set('ratingKey', '${parentRatingKey}');
          params.set('title', '${seriesTitleParam.replace(/'/g, "\\'")}');
          params.set('posterUrl', '');
          ${tmdbId ? `params.set('tmdbId', '${tmdbId}');` : ''}
          if (libraryKey) params.set('libraryKey', libraryKey);
          if (libraryTitle) params.set('libraryTitle', libraryTitle);
          
          window.location.href = \`/series-redirect?\${params.toString()}\`;
        }
        
        // Función para volver a la página de serie (mantener por compatibilidad)
        function goBackToSeries() {
          // Redirigir a /series-redirect para obtener todos los datos de la serie
          const params = new URLSearchParams();
          params.set('accessToken', '${accessToken}');
          params.set('baseURI', '${baseURI}');
          params.set('ratingKey', '${parentRatingKey}');
          params.set('title', '${seriesTitleParam.replace(/'/g, "\\'")}');
          params.set('posterUrl', '');
          ${tmdbId ? `params.set('tmdbId', '${tmdbId}');` : ''}
          if (libraryKey) params.set('libraryKey', libraryKey);
          if (libraryTitle) params.set('libraryTitle', libraryTitle);
          
          window.location.href = \`/series-redirect?\${params.toString()}\`;
        }
        
        // Función para formatear tamaño de archivo
        function formatFileSize(bytes) {
          if (!bytes || bytes === 0) return 'N/A';
          const gb = bytes / (1024 * 1024 * 1024);
          const mb = bytes / (1024 * 1024);
          if (gb >= 1) {
            return gb.toFixed(2) + ' GB';
          } else {
            return mb.toFixed(2) + ' MB';
          }
        }
        
        let isDownloading = false;
        let downloadIndex = 0;
        
        // Estado del gestor de descargas
        let downloadQueue = [];
        let currentDownloadIndex = -1;
        let isPaused = false;
        let isModalMinimized = false;
        
        function downloadEpisode(globalIndex, fromSequential = false) {
          const download = allEpisodes[globalIndex];
          
          // Descargar directamente usando la URL de Plex
          if (download.url) {
            window.location.href = download.url;
          }
          
          // Continuar con la siguiente descarga si es secuencial
          if (fromSequential) {
            downloadIndex++;
            if (downloadIndex < allEpisodes.length) {
              updateProgress();
              setTimeout(() => downloadEpisode(downloadIndex, true), 5500);
            } else {
              finishSequentialDownload();
            }
          }
        }
        
        function downloadCurrentPage() {
          if (isDownloading) return;
          
          isDownloading = true;
          let pageDownloadIndex = 0;
          
          const btn = document.getElementById('download-page-btn');
          
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25"/><path d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z"><animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/></path></svg> Descargando...';
          }
          
          function downloadNextPageEpisode() {
            if (pageDownloadIndex >= currentPageEpisodes.length) {
              // Terminar descarga de página
              isDownloading = false;
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/></svg> Descargar Esta Página (' + currentPageEpisodes.length + ' episodios)';
              }
              return;
            }
            
            const globalIndex = startIndex + pageDownloadIndex;
            downloadEpisode(globalIndex);
            pageDownloadIndex++;
            
            setTimeout(downloadNextPageEpisode, 5500);
          }
          
          downloadNextPageEpisode();
        }
        
        // Abrir modal de descargas
        function openDownloadModal() {
          // Inicializar cola con todos los episodios
          downloadQueue = allEpisodes.map((ep, idx) => ({
            index: idx,
            episode: ep,
            status: 'queued' // queued, downloading, completed, error
          }));
          
          currentDownloadIndex = -1;
          isPaused = false;
          isModalMinimized = false;
          
          // Mostrar modal
          document.getElementById('download-modal').style.display = 'flex';
          updateModalUI();
          
          // Iniciar descargas
          processNextDownload();
        }
        
        // Procesar siguiente descarga en la cola
        function processNextDownload() {
          if (isPaused) return;
          
          currentDownloadIndex++;
          
          if (currentDownloadIndex >= downloadQueue.length) {
            // Todas las descargas completadas
            document.getElementById('modal-status').textContent = '✅ Todas las descargas completadas';
            document.getElementById('pause-btn').style.display = 'none';
            document.getElementById('cancel-btn').textContent = 'Cerrar';
            return;
          }
          
          const item = downloadQueue[currentDownloadIndex];
          item.status = 'downloading';
          updateModalUI();
          
          // Construir URL del servidor intermediario (igual que los botones individuales)
          const urlObj = new URL(item.episode.url);
          const accessToken = urlObj.searchParams.get('X-Plex-Token') || '';
          const baseURI = urlObj.origin;
          const partKey = urlObj.pathname;
          
          const redirectorUrl = 'https://plex-redirect-production.up.railway.app/?'
            + 'accessToken=' + encodeURIComponent(accessToken)
            + '&partKey=' + encodeURIComponent(partKey)
            + '&baseURI=' + encodeURIComponent(baseURI)
            + '&fileSize=' + encodeURIComponent(item.episode.fileSize || '')
            + '&fileName=' + encodeURIComponent(item.episode.fileName || '')
            + '&downloadURL=' + encodeURIComponent(item.episode.url)
            + '&title=' + encodeURIComponent(item.episode.seriesTitle || '')
            + '&episodeTitle=' + encodeURIComponent(item.episode.episodeTitle || '')
            + '&seasonNumber=' + encodeURIComponent(item.episode.seasonNumber || '')
            + '&episodeNumber=' + encodeURIComponent(item.episode.episodeNumber || '')
            + '&autoDownload=true'
            + '&closeAfter=500'; // Indicar al servidor que cierre después de 500ms
          
          // Crear un elemento <a> para abrir en segundo plano sin cambiar el foco
          const link = document.createElement('a');
          link.href = redirectorUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          
          // Simular click con modificadores para abrir en segundo plano
          const evt = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            ctrlKey: true, // Ctrl+Click = abrir en segundo plano
            metaKey: true  // Cmd+Click en Mac
          });
          
          link.dispatchEvent(evt);
          
          // Marcar como completado después de dar tiempo a que se registre la descarga
          setTimeout(() => {
            item.status = 'completed';
            updateModalUI();
            
            // Esperar 6 segundos antes de la siguiente descarga (aumentado para evitar errores de red en Opera)
            setTimeout(processNextDownload, 6000);
          }, 1000);
        }
        
        // Actualizar UI del modal
        function updateModalUI() {
          const completed = downloadQueue.filter(i => i.status === 'completed').length;
          const total = downloadQueue.length;
          const percentage = Math.round((completed / total) * 100);
          
          // Calcular tamaño total
          let totalSizeBytes = 0;
          downloadQueue.forEach(item => {
            if (item.episode.fileSize) {
              totalSizeBytes += parseInt(item.episode.fileSize, 10);
            }
          });
          
          let totalSizeFormatted = '';
          if (totalSizeBytes > 0) {
            const gb = totalSizeBytes / (1024 * 1024 * 1024);
            const tb = gb / 1024;
            totalSizeFormatted = tb >= 1 ? \` • \${tb.toFixed(2)} TB\` : \` • \${gb.toFixed(2)} GB\`;
          }
          
          // Actualizar header
          document.getElementById('modal-status').textContent = \`\${completed} / \${total} episodios\${totalSizeFormatted}\`;
          document.getElementById('modal-progress-fill').style.width = percentage + '%';
          document.getElementById('modal-progress-text').textContent = percentage + '%';
          
          // Actualizar lista de episodios
          const listHTML = downloadQueue.map(item => {
            let statusIcon = '';
            let statusClass = '';
            
            if (item.status === 'queued') {
              statusIcon = '⏳';
              statusClass = 'queued';
            } else if (item.status === 'downloading') {
              statusIcon = '🔄';
              statusClass = 'downloading';
            } else if (item.status === 'completed') {
              statusIcon = '✅';
              statusClass = 'completed';
            } else if (item.status === 'error') {
              statusIcon = '❌';
              statusClass = 'error';
            }
            
            const epNum = item.episode.episodeNumber || item.index + 1;
            const epTitle = item.episode.episodeTitle || 'Sin título';
            
            return \`
              <div class="modal-episode-item \${statusClass}">
                <span class="modal-episode-status">\${statusIcon}</span>
                <span class="modal-episode-title">S\${item.episode.seasonNumber || '?'}E\${epNum} - \${epTitle}</span>
                <span class="modal-episode-size">\${item.episode.fileSizeFormatted || ''}</span>
              </div>
            \`;
          }).join('');
          
          document.getElementById('modal-episode-list').innerHTML = listHTML;
          
          // Auto-scroll al episodio actual
          const downloadingEl = document.querySelector('.modal-episode-item.downloading');
          if (downloadingEl) {
            downloadingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        
        // Pausar/Reanudar
        function togglePause() {
          isPaused = !isPaused;
          const btn = document.getElementById('pause-btn');
          
          if (isPaused) {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Reanudar';
          } else {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg> Pausar';
            processNextDownload();
          }
        }
        
        // Cancelar/Cerrar
        function cancelDownloads() {
          downloadQueue = [];
          currentDownloadIndex = -1;
          isPaused = false;
          document.getElementById('download-modal').style.display = 'none';
          
          // Limpiar iframe si existe
          const iframe = document.getElementById('download-iframe');
          if (iframe) {
            document.body.removeChild(iframe);
          }
        }
        
        // Minimizar/Maximizar
        function toggleMinimize() {
          isModalMinimized = !isModalMinimized;
          const modal = document.getElementById('download-modal');
          const btn = document.getElementById('minimize-btn');
          
          if (isModalMinimized) {
            modal.classList.add('minimized');
            btn.textContent = '🗖';
          } else {
            modal.classList.remove('minimized');
            btn.textContent = '−';
          }
        }
        
        function updateProgress() {
          const progressText = document.getElementById('progress-text');
          const progressFill = document.getElementById('progress-fill');
          if (!progressText || !progressFill) return;
          
          const percentage = Math.round((downloadIndex / allEpisodes.length) * 100);
          
          progressText.textContent = \`Descargando episodio \${downloadIndex + 1} de \${allEpisodes.length} (\${percentage}%)\`;
          progressFill.style.width = percentage + '%';
        }
        
        function finishSequentialDownload() {
          isDownloading = false;
          const btn = document.getElementById('download-season-btn');
          const progress = document.getElementById('progress-indicator');
          
          btn.disabled = false;
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/></svg> Descargar Temporada Completa';
          
          if (progress) {
            setTimeout(() => {
              progress.classList.remove('show');
            }, 2000);
          }
        }
        
        function jumpToEpisode() {
          const episodeNumber = parseInt(document.getElementById('episode-input').value);
          if (episodeNumber && episodeNumber >= 1 && episodeNumber <= allEpisodes.length) {
            const targetPage = Math.ceil(episodeNumber / pageSize);
            const downloadsParam = encodeURIComponent(JSON.stringify(${JSON.stringify(downloads)}));
            window.location.href = \`/list?downloads=\${downloadsParam}&page=\${targetPage}&pageSize=\${pageSize}\`;
          } else {
            alert('Por favor, ingresa un número de episodio válido (1-' + allEpisodes.length + ')');
          }
        }
        
        function toggleTechnical(index) {
          const content = document.getElementById('technical-content-' + index);
          const button = document.getElementById('technical-toggle-' + index);
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') 
            ? '▼ Ocultar detalles técnicos' 
            : '▶ Mostrar detalles técnicos';
        }
        
        function toggleFilename(index) {
          const text = document.getElementById('filename-' + index);
          const button = document.getElementById('expand-btn-' + index);
          text.classList.toggle('expanded');
          button.textContent = text.classList.contains('expanded') ? 'Contraer' : 'Expandir';
        }
        
        function toggleFilenameMeta(index) {
          const text = document.getElementById('filename-meta-' + index);
          const button = document.getElementById('expand-btn-meta-' + index);
          const currentFileName = allEpisodes[startIndex + index].fileName;
          
          if (button.textContent === '+') {
            text.textContent = currentFileName;
            button.textContent = '-';
          } else {
            text.textContent = currentFileName.length > 40 ? currentFileName.substring(0, 40) + '...' : currentFileName;
            button.textContent = '+';
          }
        }
        
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            if (synopsis.classList.contains('collapsed')) {
              synopsis.classList.remove('collapsed');
              button.textContent = 'Ver menos';
            } else {
              synopsis.classList.add('collapsed');
              button.textContent = 'Ver más';
            }
          }
        }
        
        // Detectar si el texto necesita "Ver más" al cargar
        window.addEventListener('load', function() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            // Verificar si el contenido se desborda
            if (synopsis.scrollHeight > synopsis.clientHeight) {
              button.style.display = 'inline-block';
            }
          }
        });
      </script>
    </head>
    <body style="margin: 0; padding: 0; overflow: hidden; background: #0f0f0f;">
      <!-- Modal Overlay -->
      <div id="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.85); z-index: 999; cursor: pointer;" onclick="closeModal()"></div>
      
      <!-- Modal Content -->
      <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; overflow-y: auto; z-index: 1000; pointer-events: none;">
        <div class="container" style="pointer-events: auto; max-width: 1400px; margin: 2rem auto; background: transparent;">
          <!-- Series Header (Banner estilo modal de Nueva carpeta) -->
          <div class="series-header" style="${backdropPath ? `background-image: url('${backdropPath}');` : 'background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);'} border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);">
            <!-- Botón cerrar -->
            <button onclick="closeModal()" style="position: absolute; top: 1rem; right: 1rem; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; width: 40px; height: 40px; border-radius: 50%; font-size: 1.5rem; cursor: pointer; transition: all 0.2s; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;" onmouseover="this.style.background='rgba(229, 160, 13, 0.9)'; this.style.color='#000'; this.style.transform='scale(1.1)';" onmouseout="this.style.background='rgba(0, 0, 0, 0.7)'; this.style.color='#fff'; this.style.transform='scale(1)';">&times;</button>
            
            <div class="series-header-overlay">
            <!-- Títulos -->
            <div class="series-titles">
              <h1>${seriesTitle}</h1>
              <h2>Temporada ${seasonNumberFromEpisode}</h2>
            </div>
            
            <!-- Content: Poster + Info -->
            <div class="series-content">
              <!-- Poster -->
              ${seasonPoster ? `<img loading="lazy" src="${seasonPoster}" alt="${seriesTitle}" class="series-poster">` : '<div class="series-poster" style="background: linear-gradient(135deg, #333 0%, #222 100%);"></div>'}
              
              <!-- Info -->
              <div class="series-info">
                <!-- Meta badges e iconos: badges a la izquierda, iconos a la derecha -->
                <div class="series-meta" style="align-items: center; justify-content: space-between; width: 100%;">
                  <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                    <span class="episodes-count-badge">${totalEpisodes} Episodio${totalEpisodes !== 1 ? 's' : ''}</span>
                    ${totalSizeFormatted ? `<span class="meta-badge">${totalSizeFormatted}</span>` : ''}
                    ${seasonYear ? `<span class="meta-badge">${seasonYear}</span>` : ''}
                  </div>
                  
                  <div style="display: flex; gap: 0.5rem; align-items: center; margin-left: auto;">
                    ${tmdbIdToUse ? `
                      <a href="https://www.themoviedb.org/tv/${tmdbIdToUse}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" style="display: inline-flex; align-items: center;">
                        <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                      </a>
                    ` : ''}
                    ${imdbId ? `
                      <a href="https://www.imdb.com/title/${imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" style="display: inline-flex; align-items: center;">
                        <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                      </a>
                    ` : ''}
                    ${trailerKey ? `
                      <a href="https://www.youtube.com/watch?v=${trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" style="display: inline-flex; align-items: center;">
                        <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                      </a>
                    ` : ''}
                  </div>
                </div>
                
                <!-- Synopsis -->
                ${seasonSummary ? `
                <div style="margin-bottom: 1rem;">
                  <div id="synopsis-text" class="series-description collapsed">
                    ${seasonSummary}
                  </div>
                  <button id="synopsis-toggle" onclick="toggleSynopsis()" class="expand-description-btn" style="display: none;">Ver más</button>
                </div>
                ` : ''}
                
                <!-- Action buttons -->
                <div class="action-buttons">
                  <button class="download-season-btn" id="download-season-btn" onclick="openDownloadModal()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                    </svg>
                    Descargar Temporada Completa
                  </button>
                </div>
                
                <!-- Progress indicator -->
                <div class="progress-indicator" id="progress-indicator">
                  <div class="progress-text" id="progress-text"></div>
                  <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        
        <!-- Lista de episodios -->
        <div class="episodes-grid" id="episodes-container">
          <!-- Los episodios se cargarán dinámicamente -->
        </div>
        
        <div id="loading-indicator" style="display: none; text-align: center; padding: 2rem; color: #e5a00d;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="31.4 31.4" />
          </svg>
          <p>Cargando más episodios...</p>
        </div>
        
        <style>
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        </style>
      </div>
      
      <!-- Modal de descargas -->
      <div id="download-modal" style="display: none; position: fixed; bottom: 20px; right: 20px; width: 450px; max-height: 600px; background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%); border: 2px solid rgba(229, 160, 13, 0.3); border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8); z-index: 9999; flex-direction: column; transition: all 0.3s ease; pointer-events: auto;">
          
        <!-- Header -->
        <div id="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; border-bottom: 1px solid rgba(229, 160, 13, 0.2);">
          <div style="flex: 1; min-width: 0;">
            <h3 style="margin: 0; color: #e5a00d; font-size: 1.1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Gestor de Descargas</h3>
            <p id="modal-status" style="margin: 0.25rem 0 0 0; color: #999; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">0 / 0 episodios</p>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-shrink: 0; margin-left: 0.75rem;">
            <button id="minimize-btn" onclick="toggleMinimize()" style="background: transparent; border: none; color: #e5a00d; font-size: 1.5rem; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;" onmouseover="this.style.color='#f0b825';" onmouseout="this.style.color='#e5a00d';">−</button>
            <button onclick="cancelDownloads()" style="background: transparent; border: none; color: #e5a00d; font-size: 1.3rem; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;" onmouseover="this.style.color='#f0b825';" onmouseout="this.style.color='#e5a00d';">✕</button>
          </div>
        </div>
        
        <!-- Barra de progreso -->
        <div style="padding: 1rem 1.5rem; border-bottom: 1px solid rgba(229, 160, 13, 0.2);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="color: #e5e5e5; font-size: 0.9rem; font-weight: 600;">Progreso total</span>
            <span id="modal-progress-text" style="color: #e5a00d; font-size: 0.9rem; font-weight: 600;">0%</span>
          </div>
          <div style="background: rgba(255, 255, 255, 0.1); height: 8px; border-radius: 4px; overflow: hidden;">
            <div id="modal-progress-fill" style="background: linear-gradient(90deg, #e5a00d 0%, #f0b825 100%); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
          </div>
        </div>
        
        <!-- Lista de episodios -->
        <div id="modal-episode-list" style="flex: 1; overflow-y: auto; padding: 1rem 1.5rem; max-height: 350px;">
          <!-- Los episodios se agregarán dinámicamente -->
        </div>
        
        <!-- Controles -->
        <div style="display: flex; gap: 0.75rem; padding: 1rem 1.5rem; border-top: 1px solid rgba(229, 160, 13, 0.2);">
          <button id="pause-btn" onclick="togglePause()" style="flex: 1; background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%); color: #000; border: none; padding: 0.75rem; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.2s ease;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(229, 160, 13, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
            Pausar
          </button>
          <button id="cancel-btn" onclick="cancelDownloads()" style="flex: 1; background: rgba(255, 59, 48, 0.15); color: #ff3b30; border: 1px solid rgba(255, 59, 48, 0.3); padding: 0.75rem; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.background='rgba(255, 59, 48, 0.25)';" onmouseout="this.style.background='rgba(255, 59, 48, 0.15)';">Cancelar</button>
        </div>
      </div>
      
      <style>
        /* Modal minimizado */
        #download-modal.minimized {
          width: 400px;
          height: 70px;
          max-height: 70px;
        }
        
        #download-modal.minimized > div:not(:first-child) {
          display: none;
        }
        
        #download-modal.minimized #modal-header {
          border-bottom: none;
        }
        
        #download-modal.minimized h3 {
          font-size: 1rem;
        }
        
        #download-modal.minimized #modal-status {
          font-size: 0.85rem;
        }
        
        /* Items de episodios */
        .modal-episode-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          border-left: 3px solid transparent;
          transition: all 0.2s ease;
        }
        
        .modal-episode-item.queued {
          border-left-color: #666;
        }
        
        .modal-episode-item.downloading {
          border-left-color: #e5a00d;
          background: rgba(229, 160, 13, 0.1);
          animation: pulse 1.5s ease-in-out infinite;
        }
        
        .modal-episode-item.completed {
          border-left-color: #34c759;
          opacity: 0.7;
        }
        
        .modal-episode-item.error {
          border-left-color: #ff3b30;
          background: rgba(255, 59, 48, 0.1);
        }
        
        .modal-episode-status {
          font-size: 1.25rem;
          flex-shrink: 0;
        }
        
        .modal-episode-title {
          color: #e5e5e5;
          font-size: 0.9rem;
          line-height: 1.4;
          flex: 1;
        }
        
        .modal-episode-size {
          color: #999;
          font-size: 0.8rem;
          margin-left: 8px;
          flex-shrink: 0;
        }
        
        @keyframes pulse {
          0%, 100% {
            background: rgba(229, 160, 13, 0.1);
          }
          50% {
            background: rgba(229, 160, 13, 0.2);
          }
        }
        
        /* Scrollbar personalizado */
        #modal-episode-list::-webkit-scrollbar {
          width: 8px;
        }
        
        #modal-episode-list::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        
        #modal-episode-list::-webkit-scrollbar-thumb {
          background: rgba(229, 160, 13, 0.5);
          border-radius: 4px;
        }
        
        #modal-episode-list::-webkit-scrollbar-thumb:hover {
          background: rgba(229, 160, 13, 0.7);
        }
      </style>
      
      <script>
        // Funciones auxiliares
        function toggleFilenameMeta(index) {
          const text = document.getElementById('filename-meta-' + index);
          const button = document.getElementById('expand-btn-meta-' + index);
          const currentFileName = allEpisodes[index].fileName;
          
          if (button.textContent === '+') {
            text.textContent = currentFileName;
            button.textContent = '-';
          } else {
            text.textContent = currentFileName.length > 40 ? currentFileName.substring(0, 40) + '...' : currentFileName;
            button.textContent = '+';
          }
        }
        
        function toggleTechnical(index) {
          const content = document.getElementById('technical-content-' + index);
          const button = document.getElementById('technical-toggle-' + index);
          const isOpen = content.style.maxHeight && content.style.maxHeight !== '0px';
          
          if (isOpen) {
            content.style.maxHeight = '0';
            button.textContent = '▶ Mostrar detalles técnicos';
          } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            button.textContent = '▼ Ocultar detalles técnicos';
          }
        }
        
        // Función para renderizar un episodio
        function renderEpisode(download, index) {
          // Construir URL para ver detalles del episodio
          const episodePageUrl = download.ratingKey 
            ? \`/episode?episodeRatingKey=\${download.ratingKey}&accessToken=\${encodeURIComponent(download.accessToken)}&baseURI=\${encodeURIComponent(download.baseURI)}&seasonRatingKey=\${download.parentRatingKey || ''}&seasonNumber=\${download.seasonNumber || ''}&episodeNumber=\${download.episodeNumber || ''}&seriesTitle=\${encodeURIComponent('${seriesTitleParam}')}\${download.grandparentRatingKey ? '&parentRatingKey=' + download.grandparentRatingKey : ''}\${'${tmdbId}' ? '&tmdbId=${tmdbId}' : ''}\${'${imdbId}' ? '&imdbId=${imdbId}' : ''}\${'${libraryKey}' ? '&libraryKey=${encodeURIComponent(libraryKey)}' : ''}\${'${libraryTitle}' ? '&libraryTitle=${encodeURIComponent(libraryTitle)}' : ''}\`
            : null;
          
          return \`
            <div class="episode-card">
              \${episodePageUrl 
                ? \`<a href="\${episodePageUrl}" style="display: block; text-decoration: none;">
                    \${download.posterUrl ? \`<img class="episode-poster" src="\${download.posterUrl}" alt="\${download.episodeTitle}" style="cursor: pointer;">\` : \`<div class="episode-poster" style="background: linear-gradient(135deg, #333 0%, #222 100%); cursor: pointer;"></div>\`}
                   </a>\`
                : \`\${download.posterUrl ? \`<img class="episode-poster" src="\${download.posterUrl}" alt="\${download.episodeTitle}">\` : \`<div class="episode-poster" style="background: linear-gradient(135deg, #333 0%, #222 100%);"></div>\`}\`
              }
              
              <div class="episode-info">
                <div class="episode-number">
                  \${download.seasonNumber ? \`Temporada \${download.seasonNumber}\` : ''} 
                  \${download.episodeNumber ? \`• Episodio \${download.episodeNumber}\` : ''}
                </div>
                \${episodePageUrl 
                  ? \`<a href="\${episodePageUrl}" style="text-decoration: none; color: inherit;"><div class="episode-title" style="cursor: pointer; transition: color 0.2s;" onmouseover="this.style.color='#e5a00d'" onmouseout="this.style.color='#fff'">\${download.episodeTitle || download.fileName}</div></a>\`
                  : \`<div class="episode-title">\${download.episodeTitle || download.fileName}</div>\`
                }
                <div class="episode-meta">
                  \${download.fileSizeFormatted ? \`<span>📦 \${download.fileSizeFormatted}</span>\` : ''}
                  <div class="filename-meta">
                    <span>📄 <span class="filename-text" id="filename-meta-\${index}">\${download.fileName.length > 40 ? download.fileName.substring(0, 40) + '...' : download.fileName}</span></span>
                    \${download.fileName.length > 40 ? \`<button class="expand-btn-meta" id="expand-btn-meta-\${index}" onclick="toggleFilenameMeta(\${index})">+</button>\` : ''}
                  </div>
                </div>
                
                <button class="technical-toggle" id="technical-toggle-\${index}" onclick="toggleTechnical(\${index})">
                  ▶ Mostrar detalles técnicos
                </button>
                <div class="technical-content" id="technical-content-\${index}">
                  <table class="info-table">
                    <tr>
                      <td class="label">Access Token</td>
                      <td class="value">\${download.accessToken ? download.accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                    </tr>
                    <tr>
                      <td class="label">Part Key</td>
                      <td class="value">\${decodeURIComponent(download.partKey)}</td>
                    </tr>
                    <tr>
                      <td class="label">Base URL</td>
                      <td class="value">\${download.baseURI}</td>
                    </tr>
                    <tr>
                      <td class="label">Nombre del archivo</td>
                      <td class="value">\${download.fileName}</td>
                    </tr>
                    <tr>
                      <td class="label">Tamaño</td>
                      <td class="value">\${download.fileSize || 'Desconocido'}</td>
                    </tr>
                    <tr>
                      <td class="label">URL de descarga</td>
                      <td class="value">\${download.url || 'N/A'}</td>
                    </tr>
                  </table>
                </div>
              </div>
              
              <button class="download-btn" onclick="downloadEpisode(\${index})">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                </svg>
                Descargar
              </button>
            </div>
          \`;
        }
        
        // Función para cargar más episodios
        function loadMoreEpisodes() {
          const container = document.getElementById('episodes-container');
          const end = Math.min(currentIndex + episodesPerLoad, totalEpisodes);
          
          for (let i = currentIndex; i < end; i++) {
            const episodeHTML = renderEpisode(allEpisodes[i], i);
            container.insertAdjacentHTML('beforeend', episodeHTML);
            displayedEpisodes.push(allEpisodes[i]);
          }
          
          currentIndex = end;
        }
        
        // Detectar scroll para cargar más
        let isLoading = false;
        window.addEventListener('scroll', function() {
          if (isLoading) return;
          
          const scrollPosition = window.innerHeight + window.scrollY;
          const documentHeight = document.documentElement.scrollHeight;
          
          // Cargar más cuando estemos a 500px del final
          if (scrollPosition >= documentHeight - 500 && currentIndex < totalEpisodes) {
            isLoading = true;
            document.getElementById('loading-indicator').style.display = 'block';
            
            setTimeout(() => {
              loadMoreEpisodes();
              document.getElementById('loading-indicator').style.display = 'none';
              isLoading = false;
            }, 300);
          }
        });
        
        // Cargar episodios iniciales
        loadMoreEpisodes();
      </script>
    </body>
    </html>
  `);
});

// Ruta redirectora para películas desde /browse
app.get('/movie-redirect', async (req, res) => {
  const {
    accessToken = '',
    baseURI = '',
    ratingKey = '',
    title = '',
    posterUrl = '',
    tmdbId = '',
    libraryKey = '',
    libraryTitle = ''
  } = req.query;
  
  // console.log('[/movie-redirect] Obteniendo datos de película desde ratingKey:', ratingKey);
  
  try {
    // Obtener XML de Plex para extraer fileName, fileSize, partKey y year
    const metadataUrl = `${baseURI}/library/metadata/${ratingKey}?X-Plex-Token=${accessToken}`;
    const xmlText = await httpsGetXML(metadataUrl);
    
    // Extraer partKey
    let partKey = '';
    const partKeyMatch = xmlText.match(/<Part[^>]*key="([^"]*)"[^>]*>/);
    if (partKeyMatch) {
      const fullPartKey = partKeyMatch[1];
      // console.log('[/movie-redirect] fullPartKey:', fullPartKey);
      
      // Crear partKey sin el fileName (termina en /)
      partKey = fullPartKey.replace(/\/[^\/]+$/, '/');
      // console.log('[/movie-redirect] partKey extraído:', partKey);
    } else {
      // console.log('[/movie-redirect] ❌ No se pudo extraer partKey del XML');
    }
    
    // Debug: Mostrar un fragmento del XML para ver qué contiene
    const partSection = xmlText.substring(xmlText.indexOf('<Part'), xmlText.indexOf('</Part>') + 7);
    // console.log('[/movie-redirect] XML Part section:', partSection);
    
    // Extraer fileName del atributo file (contiene la ruta completa)
    let fileName = '';
    // Usar un regex más específico que busque " file=" para evitar capturar otros atributos
    const fileMatch = xmlText.match(/\sfile="([^"]+)"/);
    if (fileMatch) {
      const fullFilePath = fileMatch[1];
      // console.log('[/movie-redirect] fullFilePath extraído:', fullFilePath);
      
      // Extraer solo el nombre del archivo (último segmento después de /)
      const segments = fullFilePath.split('/');
      fileName = segments[segments.length - 1];
      // console.log('[/movie-redirect] fileName extraído del atributo file:', fileName);
    } else {
      // console.log('[/movie-redirect] ⚠️ No se encontró atributo file, usando fileName del partKey');
      // Fallback: extraer del partKey
      if (partKeyMatch) {
        const segments = partKeyMatch[1].split('/');
        fileName = segments[segments.length - 1];
        // console.log('[/movie-redirect] fileName extraído del partKey (fallback):', fileName);
      }
    }
    
    // Extraer fileSize
    let fileSize = '';
    const sizeMatch = xmlText.match(/<Part[^>]*size="([^"]*)"[^>]*>/);
    if (sizeMatch) {
      const bytes = parseInt(sizeMatch[1]);
      const gb = bytes / (1024 * 1024 * 1024);
      fileSize = gb >= 1 ? gb.toFixed(2) + ' GBs' : (gb * 1024).toFixed(2) + ' MBs';
      // console.log('[/movie-redirect] fileSize extraído:', fileSize);
    }
    
    // Extraer año
    let year = '';
    const yearMatch = xmlText.match(/<Video[^>]*year="([^"]*)"[^>]*>/);
    if (yearMatch) {
      year = yearMatch[1];
      // console.log('[/movie-redirect] year extraído:', year);
    }
    
    // Extraer tmdbId del guid si no viene en los parámetros
    let extractedTmdbId = tmdbId;
    if (!extractedTmdbId || extractedTmdbId.trim() === '') {
      // Buscar el atributo guid en cualquier lugar del tag Video
      const guidMatch = xmlText.match(/guid="[^"]*tmdb:\/\/(\d+)/i);
      if (guidMatch) {
        extractedTmdbId = guidMatch[1];
        // console.log('[/movie-redirect] ✅ tmdbId extraído del XML:', extractedTmdbId);
      } else {
        // Intentar extraer del nombre del archivo si contiene [tmdb-XXXXX]
        const fileNameMatch = fileName.match(/\[tmdb-(\d+)\]/i);
        if (fileNameMatch) {
          extractedTmdbId = fileNameMatch[1];
          // console.log('[/movie-redirect] ✅ tmdbId extraído del nombre del archivo:', extractedTmdbId);
        } else {
          // console.log('[/movie-redirect] ⚠️ No se encontró tmdbId en el XML ni en el nombre del archivo, se usará búsqueda automática');
        }
      }
    }
    
    // Construir downloadURL correcto con download=0
    const downloadURL = partKey && fileName 
      ? `${baseURI}${partKey}${fileName}?download=0&X-Plex-Token=${accessToken}`
      : `${baseURI}/library/metadata/${ratingKey}?download=0&X-Plex-Token=${accessToken}`;
    
    // Redirigir a /movie con todos los parámetros incluyendo tmdbId extraído
    const redirectUrl = `/movie?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&downloadURL=${encodeURIComponent(downloadURL)}&partKey=${encodeURIComponent(partKey)}&title=${encodeURIComponent(title)}&year=${year}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${extractedTmdbId}&fileName=${encodeURIComponent(fileName)}&fileSize=${encodeURIComponent(fileSize)}&libraryKey=${libraryKey}&libraryTitle=${encodeURIComponent(libraryTitle)}`;
    
    // console.log('[/movie-redirect] Redirigiendo a /movie con todos los parámetros (tmdbId:', extractedTmdbId, ')');
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('[/movie-redirect] Error al obtener datos:', error);
    // Si falla, redirigir sin los datos extras
    res.redirect(`/movie?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}&libraryKey=${libraryKey}&libraryTitle=${encodeURIComponent(libraryTitle)}`);
  }
});

// Ruta redirectora para series desde /browse
app.get('/series-redirect', async (req, res) => {
  const {
    accessToken = '',
    baseURI = '',
    ratingKey = '',
    title = '',
    posterUrl = '',
    tmdbId = '',
    libraryKey = '',
    libraryTitle = ''
  } = req.query;
  
  // console.log('[/series-redirect] Obteniendo datos de serie desde ratingKey:', ratingKey);
  // console.log('[/series-redirect] libraryKey recibido:', libraryKey);
  // console.log('[/series-redirect] libraryTitle recibido:', libraryTitle);
  
  try {
    // Obtener XML de Plex para extraer datos de la serie
    const metadataUrl = `${baseURI}/library/metadata/${ratingKey}?X-Plex-Token=${accessToken}`;
    const xmlText = await httpsGetXML(metadataUrl);
    
    // Extraer tmdbId del guid si no viene en los parámetros
    let extractedTmdbId = tmdbId;
    if (!extractedTmdbId || extractedTmdbId.trim() === '') {
      const guidMatch = xmlText.match(/guid="[^"]*tmdb:\/\/(\d+)/i);
      if (guidMatch) {
        extractedTmdbId = guidMatch[1];
        // console.log('[/series-redirect] ✅ tmdbId extraído del XML:', extractedTmdbId);
      } else {
        // console.log('[/series-redirect] ⚠️ No se encontró tmdbId en el XML, se usará búsqueda automática');
      }
    }
    
    // Obtener las temporadas
    const seasonsUrl = `${baseURI}/library/metadata/${ratingKey}/children?X-Plex-Token=${accessToken}`;
    const seasonsXml = await httpsGetXML(seasonsUrl);
    
    const seasons = [];
    const seasonMatches = seasonsXml.matchAll(/<Directory[^>]*>/g);
    
    for (const match of seasonMatches) {
      const seasonTag = match[0];
      const seasonRatingKey = seasonTag.match(/ratingKey="([^"]*)"/)?.[1];
      const seasonTitle = seasonTag.match(/title="([^"]*)"/)?.[1];
      const seasonIndex = seasonTag.match(/index="([^"]*)"/)?.[1];
      const seasonThumb = seasonTag.match(/thumb="([^"]*)"/)?.[1];
      const leafCount = seasonTag.match(/leafCount="([^"]*)"/)?.[1] || '0';
      
      if (seasonRatingKey && seasonTitle) {
        seasons.push({
          ratingKey: seasonRatingKey,
          title: seasonTitle,
          seasonNumber: seasonIndex || '',
          thumb: seasonThumb ? `${baseURI}${seasonThumb}?X-Plex-Token=${accessToken}` : '',
          episodeCount: leafCount
        });
      }
    }
    
    // console.log('[/series-redirect] Temporadas encontradas:', seasons.length);
    
    // Redirigir a /series con todos los parámetros incluyendo seasons
    const redirectUrl = `/series?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&seriesId=${ratingKey}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${extractedTmdbId}&seasons=${encodeURIComponent(JSON.stringify(seasons))}${libraryKey ? '&libraryKey=' + encodeURIComponent(libraryKey) : ''}${libraryTitle ? '&libraryTitle=' + encodeURIComponent(libraryTitle) : ''}`;
    
    // console.log('[/series-redirect] Redirigiendo a /series con', seasons.length, 'temporadas (tmdbId:', extractedTmdbId, ')');
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('[/series-redirect] Error al obtener datos:', error);
    // Si falla, redirigir sin los datos extras
    res.redirect(`/series?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&seriesId=${ratingKey}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}${libraryKey ? '&libraryKey=' + encodeURIComponent(libraryKey) : ''}${libraryTitle ? '&libraryTitle=' + encodeURIComponent(libraryTitle) : ''}`);
  }
});

// Ruta para películas individuales
app.get('/movie', async (req, res) => {
  const {
    accessToken = '',
    partKey: encodedPartKey = '',
    baseURI = '',
    fileSize = '',
    fileName = '',
    downloadURL = '',
    title = '',
    year = '',
    posterUrl = '',
    tmdbId = ''
  } = req.query;
  
  let libraryKey = req.query.libraryKey || '';
  let libraryTitle = req.query.libraryTitle || '';

  let partKey = decodeURIComponent(encodedPartKey);
  
  // Extraer accessToken del downloadURL si no viene como parámetro
  let finalAccessToken = accessToken;
  if (!finalAccessToken && downloadURL) {
    const tokenMatch = downloadURL.match(/X-Plex-Token=([^&]+)/);
    if (tokenMatch) {
      finalAccessToken = tokenMatch[1];
      console.log('[/movie] 🔑 AccessToken extraído del downloadURL');
    }
  }
  
  // Extraer baseURI del downloadURL si no viene como parámetro
  let finalBaseURI = baseURI;
  if (!finalBaseURI && downloadURL) {
    const urlMatch = downloadURL.match(/(https?:\/\/[^\/]+)/);
    if (urlMatch) {
      finalBaseURI = urlMatch[1];
      console.log('[/movie] 🌐 BaseURI extraído del downloadURL:', finalBaseURI);
    }
  }
  
  // Log para debug
  console.log('[/movie] Parámetros recibidos:', {
    tmdbId,
    year,
    fileSize,
    title,
    downloadURL,
    partKey: encodedPartKey,
    fileName,
    libraryKey,
    libraryTitle
  });
  
  // Log final de libraryKey
  console.log('[/movie] libraryKey final:', libraryKey, 'libraryTitle:', libraryTitle);
  
  // Si no hay fileSize, intentar extraerlo del XML de Plex junto con detalles técnicos
  let calculatedFileSize = fileSize;
  let videoCodec = '';
  let audioCodec = '';
  let resolution = '';
  let bitrate = '';
  let container = '';
  let quality = '';
  let movieYear = '';
  let originalTitle = '';
  let plexRating = null; // Rating de Plex (audienceRating)
  
  // SIEMPRE intentar extraer rating de Plex si tenemos downloadURL
  if (downloadURL && finalBaseURI && finalAccessToken) {
    try {
      const ratingKeyMatch = downloadURL.match(/\/library\/metadata\/(\d+)/);
      if (ratingKeyMatch) {
        const ratingKey = ratingKeyMatch[1];
        const metadataUrl = `${finalBaseURI}/library/metadata/${ratingKey}?X-Plex-Token=${finalAccessToken}`;
        console.log('[/movie] 📡 Obteniendo metadata de:', metadataUrl);
        const xmlText = await httpsGetXML(metadataUrl);
        
        // DEBUG: Mostrar TODO el XML para ver qué atributos tiene
        console.log('[/movie] ========== XML COMPLETO ==========');
        console.log(xmlText);
        console.log('[/movie] ====================================');
        
        // Extraer rating IGUAL que en /browse
        const videoTagMatch = xmlText.match(/<Video[^>]*>/);
        if (videoTagMatch) {
          const videoTag = videoTagMatch[0];
          const audienceRatingMatch = videoTag.match(/audienceRating="([^"]*)"/);
          const ratingAttrMatch = videoTag.match(/rating="([^"]*)"/);
          
          if (audienceRatingMatch) {
            plexRating = parseFloat(audienceRatingMatch[1]);
            console.log('[/movie] ⭐ Rating de Plex (audienceRating) extraído:', plexRating);
          } else if (ratingAttrMatch) {
            plexRating = parseFloat(ratingAttrMatch[1]);
            console.log('[/movie] ⭐ Rating de Plex (rating) extraído:', plexRating);
          } else {
            console.log('[/movie] ⚠️ NO se encontró rating en el tag <Video>');
          }
        } else {
          console.log('[/movie] ⚠️ NO se encontró tag <Video> en el XML');
        }
      }
    } catch (error) {
      console.error('[/movie] ❌ Error al extraer rating de Plex:', error);
    }
  } else {
    console.log('[/movie] ⚠️ Faltan datos para extraer rating:', { downloadURL: !!downloadURL, baseURI: !!finalBaseURI, accessToken: !!finalAccessToken });
  }
  
  if ((!fileSize || !partKey) && downloadURL && finalBaseURI && finalAccessToken) {
    try {
      const ratingKeyMatch = downloadURL.match(/\/library\/metadata\/(\d+)/);
      if (ratingKeyMatch) {
        const ratingKey = ratingKeyMatch[1];
        const metadataUrl = `${finalBaseURI}/library/metadata/${ratingKey}?X-Plex-Token=${finalAccessToken}`;
        // console.log('[/movie] Obteniendo XML de Plex para extraer datos técnicos...');
        const xmlText = await httpsGetXML(metadataUrl);
        
        // Extraer partKey si no viene en parámetros
        if (!partKey) {
          const partKeyMatch = xmlText.match(/<Part[^>]*key="([^"]*)"[^>]*>/);
          if (partKeyMatch) {
            const fullPartKey = partKeyMatch[1];
            // Extraer solo la base del partKey (sin el filename)
            partKey = fullPartKey.replace(/\/[^\/]+$/, '/');
            // console.log('[/movie] partKey extraído del XML:', partKey);
          }
        }
        
        // Extraer fileSize
        const sizeMatch = xmlText.match(/<Part[^>]*size="([^"]*)"[^>]*>/);
        if (sizeMatch) {
          const bytes = parseInt(sizeMatch[1]);
          const gb = bytes / (1024 * 1024 * 1024);
          calculatedFileSize = gb >= 1 ? gb.toFixed(2) + ' GBs' : (gb * 1024).toFixed(2) + ' MBs';
          // console.log('[/movie] fileSize extraído del XML:', calculatedFileSize);
        }
        
        // Extraer año y título original
        const yearMatch = xmlText.match(/<Video[^>]*year="([^"]*)"[^>]*>/);
        if (yearMatch) {
          movieYear = yearMatch[1];
          // console.log('[/movie] Año extraído del XML:', movieYear);
        }
        
        const originalTitleMatch = xmlText.match(/<Video[^>]*originalTitle="([^"]*)"[^>]*>/);
        if (originalTitleMatch) {
          originalTitle = originalTitleMatch[1];
          // console.log('[/movie] Título original extraído:', originalTitle);
        }
        
        // Extraer detalles técnicos del Media
        const videoCodecMatch = xmlText.match(/<Media[^>]*videoCodec="([^"]*)"[^>]*>/);
        if (videoCodecMatch) videoCodec = videoCodecMatch[1];
        
        const audioCodecMatch = xmlText.match(/<Media[^>]*audioCodec="([^"]*)"[^>]*>/);
        if (audioCodecMatch) audioCodec = audioCodecMatch[1];
        
        const videoResolutionMatch = xmlText.match(/<Media[^>]*videoResolution="([^"]*)"[^>]*>/);
        if (videoResolutionMatch) {
          resolution = `${videoResolutionMatch[1]}p`;
          const resValue = parseInt(videoResolutionMatch[1]);
          if (resValue >= 2160) quality = '4K';
          else if (resValue >= 1080) quality = 'Full HD';
          else if (resValue >= 720) quality = 'HD';
          else quality = 'SD';
        }
        
        const bitrateMatch = xmlText.match(/<Media[^>]*bitrate="([^"]*)"[^>]*>/);
        if (bitrateMatch) bitrate = `${Math.round(parseInt(bitrateMatch[1]) / 1000)} Mbps`;
        
        const containerMatch = xmlText.match(/<Media[^>]*container="([^"]*)"[^>]*>/);
        if (containerMatch) container = containerMatch[1].toUpperCase();
        
        // console.log('[/movie] Detalles técnicos:', { videoCodec, audioCodec, resolution, bitrate, container, quality });
      }
    } catch (error) {
      console.error('[/movie] Error al extraer datos del XML:', error);
    }
  }
  
  // Usar año del parámetro como fallback si no viene en el XML
  if (!movieYear && year) {
    movieYear = year;
    // console.log('[/movie] Usando año del parámetro como fallback:', movieYear);
  }
  
  // Obtener datos completos de TMDB si tenemos el ID
  let movieData = null;
  let autoSearchedTmdbId = '';
  
  if (tmdbId && tmdbId.trim() !== '') {
    // console.log('[/movie] Llamando a fetchTMDBMovieData con tmdbId:', tmdbId);
    movieData = await fetchTMDBMovieData(tmdbId, plexRating);
    console.log('[/movie] 🎬 movieData.rating después de fetchTMDBMovieData:', movieData ? movieData.rating : 'NO DATA');
    console.log('[/movie] 🎬 plexRating pasado a función:', plexRating);
    // console.log('[/movie] movieData obtenido:', movieData ? 'SI' : 'NO');
    if (movieData) {
      // console.log('[/movie] movieData.title:', movieData.title);
      // console.log('[/movie] movieData.year:', movieData.year);
      // console.log('[/movie] movieData.genres:', movieData.genres);
    }
  } else if (title && movieYear) {
    // Decodificar HTML entities en el título antes de buscar
    const decodedTitle = decodeHtmlEntities(title);
    
    // Búsqueda automática en TMDB por título + año
    // console.log('[/movie] NO hay tmdbId - buscando automáticamente en TMDB:', decodedTitle, movieYear);
    try {
      const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(decodedTitle)}&year=${movieYear}`;
      const searchResults = await httpsGet(searchUrl);
      
      if (searchResults && searchResults.results && searchResults.results.length > 0) {
        // Tomar el primer resultado que coincida con el año
        const firstResult = searchResults.results[0];
        autoSearchedTmdbId = firstResult.id.toString();
        // console.log('[/movie] ✅ TMDB ID encontrado automáticamente:', autoSearchedTmdbId, '- Título:', firstResult.title);
        
        // Obtener datos completos con el ID encontrado
        movieData = await fetchTMDBMovieData(autoSearchedTmdbId, plexRating);
        console.log('[/movie] 🎬 movieData.rating después de búsqueda automática:', movieData ? movieData.rating : 'NO DATA');
        console.log('[/movie] 🎬 plexRating pasado a función:', plexRating);
        // console.log('[/movie] movieData obtenido por búsqueda automática');
      } else {
        // console.log('[/movie] ⚠️ No se encontraron resultados en TMDB para:', title, movieYear);
      }
    } catch (error) {
      console.error('[/movie] Error en búsqueda automática de TMDB:', error);
    }
  } else {
    // console.log('[/movie] NO SE RECIBIÓ tmdbId ni título+año válidos');
  }
  
  // Usar datos de TMDB o fallback a los datos de Plex
  const movieTitle = movieData ? movieData.title : title;
  const moviePoster = movieData && movieData.posterPath ? movieData.posterPath : posterUrl;
  const movieBackdrop = movieData && movieData.backdropPath ? movieData.backdropPath : posterUrl;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${movieTitle} - Infinity Scrap</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: transparent;
          color: #e5e5e5;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        
        .modal-content {
          background: #282828;
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          z-index: 999;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        
        .modal-content::-webkit-scrollbar {
          width: 8px;
        }
        
        .modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .modal-content::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        .modal-backdrop-header {
          position: relative;
          background-size: cover;
          background-position: center top;
          background-repeat: no-repeat;
          background-image: url('${movieBackdrop}');
          min-height: 220px;
          display: flex;
          align-items: flex-end;
          padding: 2.5rem 3.5rem 1.5rem 3.5rem;
          border-radius: 12px 12px 0 0;
        }
        
        .modal-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.3) 0%,
            rgba(0, 0, 0, 0.6) 50%,
            rgba(40, 40, 40, 0.95) 100%
          );
          border-radius: 12px 12px 0 0;
          z-index: 1;
        }
        
        .modal-header-content {
          position: relative;
          z-index: 2;
          width: 100%;
        }
        
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          z-index: 998;
          cursor: pointer;
          backdrop-filter: blur(4px);
        }
        
        .close-button {
          position: absolute;
          top: 1.5rem;
          right: 2rem;
          z-index: 3;
          background: rgba(0, 0, 0, 0.6);
          border: 2px solid rgba(255, 255, 255, 0.3);
          color: white;
          font-size: 2rem;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          line-height: 1;
          padding: 0;
        }
        
        .close-button:hover {
          background: rgba(229, 160, 13, 0.9);
          border-color: #e5a00d;
          transform: scale(1.1);
        }
        
        .modal-title {
          font-size: 2.8rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          text-shadow: 2px 2px 6px rgba(0, 0, 0, 0.8);
          line-height: 1.1;
          color: white;
        }
        
        .modal-tagline {
          color: rgba(255, 255, 255, 0.9);
          font-size: 1.1rem;
          font-style: italic;
          text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8);
          margin-bottom: 1rem;
        }
        
        .modal-badges-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .modal-icons-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-left: auto;
        }
        
        .year-badge,
        .runtime-badge,
        .filesize-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .rating-badge {
          background: rgba(249, 168, 37, 0.2);
          border: 2px solid #f9a825;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #f9a825;
          font-weight: 600;
        }
        
        .genres-list {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .genre-tag {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.3rem 0.8rem;
          border-radius: 15px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.9);
          transition: all 0.3s ease;
        }
        
        .badge-icon-link {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }
        
        .badge-icon-link:hover {
          transform: scale(1.1);
        }
        
        .badge-icon {
          height: 32px;
          width: 32px;
          object-fit: contain;
        }
        
        .modal-hero {
          padding: 1rem 3.5rem;
          display: flex;
          gap: 2rem;
        }
        
        .modal-poster-container {
          flex-shrink: 0;
        }
        
        .modal-poster-hero {
          width: 300px;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        }
        
        .modal-poster-hero img {
          width: 100%;
          height: auto;
          display: block;
          object-fit: cover;
        }
        
        .download-button {
          width: 100%;
          margin-top: 1rem;
          background: #e5a00d;
          color: #1e1e27;
          border: none;
          border-radius: 8px;
          padding: 1rem;
          font-weight: bold;
          font-size: 1.1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .download-button:hover {
          background: #e0b316;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(229, 160, 13, 0.4);
        }
        
        .modal-main-info {
          flex: 1;
        }
        
        .modal-details-table {
          display: grid;
          grid-template-columns: 1fr;
          justify-content: space-between;
          gap: 0;
          margin-bottom: 1rem;
          background: rgba(255, 255, 255, 0.07);
          padding: 0.5rem;
          border-radius: 8px;
        }
        
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(229, 160, 13, 0.08);
        }
        
        .detail-item:last-child {
          border-bottom: none;
        }
        
        .detail-item strong {
          color: #e5e5e5;
          font-weight: 600;
        }
        
        .detail-item span {
          color: #e5e5e5;
          text-align: right;
        }
        
        .synopsis-container {
          position: relative;
        }
        
        .modal-synopsis {
          line-height: 1.7;
          font-size: 1.08rem;
          text-align: justify;
          margin-bottom: 0.5rem;
          color: #cccccc;
          max-height: 6.8em;
          overflow: hidden;
          transition: max-height 0.3s ease;
          position: relative;
        }
        
        .modal-synopsis.expanded {
          max-height: none;
        }
        
        .synopsis-toggle {
          background: transparent;
          border: none;
          color: #e5a00d;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          transition: color 0.2s ease;
          text-decoration: underline;
          display: none;
        }
        
        .synopsis-toggle:hover {
          color: #f0b825;
        }
        
        .external-links a {
          transition: transform 0.3s ease, opacity 0.3s ease;
          display: block;
        }
        
        .external-links a:hover {
          transform: scale(1.1);
          opacity: 0.8;
        }
        
        .site-logo {
          height: 40px;
          width: auto;
          object-fit: contain;
        }
        
        .file-info {
          background: rgba(0, 0, 0, 0.3);
          padding: 0.5rem 3.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .technical-details {
          max-width: 800px;
          margin: 0 auto;
        }
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: all 0.2s;
          width: 100%;
          text-align: center;
          display: block;
        }
        
        .technical-toggle:hover {
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 500px;
          margin-top: 16px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .info-table td {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.85rem;
        }
        
        .info-table td.label {
          color: #888;
          font-weight: 500;
          width: 35%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          word-break: break-all;
        }
        
        @media (max-width: 768px) {
          .modal-hero {
            flex-direction: column;
            padding: 1.5rem;
          }
          
          .modal-poster-hero {
            width: 100%;
            max-width: 300px;
            margin: 0 auto;
          }
          
          .modal-backdrop-header {
            padding: 2rem 1.5rem 1rem;
          }
          
          .modal-title {
            font-size: 2rem;
          }
          
          .modal-badges-container {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          
          .modal-icons-row {
            margin-left: 0;
          }
          
          .file-info {
            padding: 1rem 1.5rem;
          }
          
          .detail-item {
            flex-direction: column;
            gap: 0.3rem;
          }
          
          .detail-item strong {
            min-width: auto;
          }
        }
      </style>
    </head>
    <body>
      <div class="modal-overlay" onclick="closeMovieModal()"></div>
      <div class="modal-content">
        <!-- Header con backdrop -->
        <div class="modal-backdrop-header">
          <button class="close-button" onclick="closeMovieModal()" title="Cerrar">&times;</button>
          <div class="modal-backdrop-overlay"></div>
          <div class="modal-header-content">
            <h1 class="modal-title">${movieTitle}</h1>
            ${movieData && movieData.tagline ? `<div class="modal-tagline">${movieData.tagline}</div>` : ''}
            <div class="modal-badges-container">
              <div class="modal-badges-row">
                ${calculatedFileSize ? `<span class="filesize-badge">${calculatedFileSize}</span>` : ''}
                ${quality ? `<span class="year-badge">${quality}</span>` : ''}
                ${movieData && movieData.year ? `<span class="year-badge">${movieData.year}</span>` : (movieYear ? `<span class="year-badge">${movieYear}</span>` : '')}
                ${movieData && movieData.runtime ? `<span class="runtime-badge">${movieData.runtime}</span>` : ''}
                ${movieData && movieData.rating !== 'N/A' ? `
                  <span class="rating-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    ${movieData.rating}
                  </span>
                ` : ''}
                ${movieData && movieData.genres && movieData.genres.length > 0 ? `
                  <div class="genres-list">
                    ${movieData.genres.slice(0, 3).map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
              <div class="modal-icons-row">
                ${(tmdbId || autoSearchedTmdbId) ? `
                  <a href="https://www.themoviedb.org/movie/${tmdbId || autoSearchedTmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" class="badge-icon">
                  </a>
                ` : ''}
                ${movieData && movieData.imdbId ? `
                  <a href="https://www.imdb.com/title/${movieData.imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" class="badge-icon">
                  </a>
                ` : ''}
                ${movieData && movieData.trailerKey ? `
                  <a href="https://www.youtube.com/watch?v=${movieData.trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" class="badge-icon">
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Hero con poster e info -->
        <div class="modal-hero">
          <div class="modal-poster-container">
            <div class="modal-poster-hero">
              <img loading="lazy" src="${moviePoster}" alt="${movieTitle}" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg';">
            </div>
            <button class="download-button" onclick="window.location.href='${downloadURL}'">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
              Descargar Película
            </button>
          </div>
          
          <div class="modal-main-info">
            ${movieData ? `
              <div class="modal-details-table">
                <div class="detail-item"><strong>Votos:</strong> <span>${movieData.voteCount}</span></div>
                <div class="detail-item"><strong>Título original:</strong> <span>${movieData.originalTitle}</span></div>
                <div class="detail-item"><strong>Fecha de estreno:</strong> <span>${movieData.releaseDate}</span></div>
                <div class="detail-item"><strong>Países:</strong> <span>${movieData.countries}</span></div>
                <div class="detail-item"><strong>Idioma original:</strong> <span>${movieData.originalLanguage}</span></div>
                <div class="detail-item"><strong>Director:</strong> <span>${movieData.director}</span></div>
                <div class="detail-item"><strong>Reparto:</strong> <span>${movieData.cast}</span></div>
                <div class="detail-item"><strong>Presupuesto:</strong> <span>${movieData.budget}</span></div>
                <div class="detail-item"><strong>Recaudación:</strong> <span>${movieData.revenue}</span></div>
              </div>
              <div class="synopsis-container">
                <div class="modal-synopsis" id="synopsis-text">
                  ${movieData.overview}
                </div>
                <button class="synopsis-toggle" id="synopsis-toggle" onclick="toggleSynopsis()">Ver más</button>
              </div>
            ` : `
              <div class="synopsis-container">
                <div class="modal-synopsis">
                  Película lista para descargar. Haz clic en el botón de descarga para comenzar.
                </div>
              </div>
            `}
          </div>
        </div>
        
        <!-- Info del archivo -->
        <div class="file-info">
          <div class="technical-details">
            <button class="technical-toggle" id="technical-toggle" onclick="toggleTechnical()">
              ▶ Mostrar detalles técnicos
            </button>
            <div class="technical-content" id="technical-content">
              <table class="info-table">
                <tr>
                  <td class="label">Access Token</td>
                  <td class="value">${accessToken ? accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                </tr>
                <tr>
                  <td class="label">Part Key</td>
                  <td class="value">${partKey || 'N/A'}</td>
                </tr>
                <tr>
                  <td class="label">Base URI</td>
                  <td class="value">${baseURI}</td>
                </tr>
                <tr>
                  <td class="label">Nombre del archivo</td>
                  <td class="value">${fileName || 'N/A'}</td>
                </tr>
                <tr>
                  <td class="label">Tamaño</td>
                  <td class="value">${calculatedFileSize || 'Desconocido'}</td>
                </tr>
                <tr>
                  <td class="label">URL de Descarga</td>
                  <td class="value" style="word-break: break-all;">${downloadURL}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        function closeMovieModal() {
          const libraryKey = '${libraryKey}';
          const libraryTitle = '${libraryTitle.replace(/'/g, "\\'")}';
          const accessToken = '${accessToken}';
          const baseURI = '${baseURI}';
          
          if (libraryKey && accessToken && baseURI) {
            const libraryTitleParam = libraryTitle || 'Movies';
            window.location.href = '/browse?accessToken=' + encodeURIComponent(accessToken) + 
                                   '&baseURI=' + encodeURIComponent(baseURI) + 
                                   '&libraryKey=' + encodeURIComponent(libraryKey) + 
                                   '&libraryTitle=' + encodeURIComponent(libraryTitleParam) + 
                                   '&libraryType=movie';
          } else if (accessToken && baseURI) {
            // Si no hay libraryKey, ir a la página de selección de bibliotecas
            window.location.href = '/library?accessToken=' + encodeURIComponent(accessToken) + 
                                   '&baseURI=' + encodeURIComponent(baseURI);
          } else {
            window.history.back();
          }
        }
        
        function toggleTechnical() {
          const content = document.getElementById('technical-content');
          const button = document.getElementById('technical-toggle');
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') 
            ? '▼ Ocultar detalles técnicos' 
            : '▶ Mostrar detalles técnicos';
        }
        
        // **SINCRONIZACIÓN DE RATING CON LOCALSTORAGE**
        (function syncRatingWithLocalStorage() {
          const tmdbIdUsed = '${tmdbId || autoSearchedTmdbId}';
          if (!tmdbIdUsed) return;
          
          // PRIORIDAD 1: Si Plex tiene rating, NO hacer nada (ya está en el HTML)
          const plexHasRating = ${movieData && movieData.rating !== 'N/A' ? 'true' : 'false'};
          if (plexHasRating) {
            console.log('[RATING] Usando rating de Plex, no consultando TMDB');
            return; // El badge ya está en el HTML renderizado
          }
          
          // PRIORIDAD 2: Verificar si YA existe el badge en el DOM
          const badgesRow = document.querySelector('.modal-badges-row');
          const existingRating = badgesRow ? badgesRow.querySelector('.rating-badge') : null;
          if (existingRating) {
            console.log('[RATING] Badge ya existe en el DOM, saltando');
            return; // Ya hay un badge, no crear duplicado
          }
          
          // PRIORIDAD 3: Si Plex NO tiene rating, buscar en localStorage
          const cacheKey = \`tmdb_rating_movie_\${tmdbIdUsed}\`;
          const cachedRating = localStorage.getItem(cacheKey);
          
          if (cachedRating && cachedRating !== '0' && cachedRating !== '0.0') {
            console.log('[RATING] Encontrado en localStorage:', cachedRating);
            // Crear badge con rating de localStorage
            if (badgesRow) {
              const ratingBadge = document.createElement('span');
              ratingBadge.className = 'rating-badge';
              ratingBadge.innerHTML = \`
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                </svg>
                \${cachedRating}
              \`;
              badgesRow.insertBefore(ratingBadge, badgesRow.querySelector('.genres-list'));
            }
            return;
          }
          
          // PRIORIDAD 4: Si no hay rating en Plex ni en cache, consultar TMDB
          console.log('[RATING] Consultando TMDB API para:', tmdbIdUsed);
          fetch(\`https://api.themoviedb.org/3/movie/\${tmdbIdUsed}?api_key=${TMDB_API_KEY}\`)
            .then(res => res.json())
            .then(data => {
              if (data.vote_average) {
                const rating = data.vote_average.toFixed(1);
                localStorage.setItem(cacheKey, rating);
                console.log('[RATING] TMDB guardado en localStorage:', rating);
                
                // Crear el rating badge SOLO si no existe
                const badgesRow = document.querySelector('.modal-badges-row');
                const existingRating = badgesRow ? badgesRow.querySelector('.rating-badge') : null;
                
                if (badgesRow && !existingRating) {
                  const ratingBadge = document.createElement('span');
                  ratingBadge.className = 'rating-badge';
                  ratingBadge.innerHTML = \`
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    \${rating}
                  \`;
                  badgesRow.insertBefore(ratingBadge, badgesRow.querySelector('.genres-list'));
                }
              }
            })
            .catch(err => console.error('[RATING] Error consultando TMDB:', err));
        })();
        
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          
          if (synopsis.classList.contains('expanded')) {
            synopsis.classList.remove('expanded');
            button.textContent = 'Ver más';
          } else {
            synopsis.classList.add('expanded');
            button.textContent = 'Ver menos';
          }
        }
        
        // Detectar si el texto necesita "Ver más" al cargar
        window.addEventListener('load', function() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            // Verificar si el contenido se desborda
            if (synopsis.scrollHeight > synopsis.clientHeight) {
              button.style.display = 'inline-block';
            }
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Ruta para series
app.get('/series', async (req, res) => {
  const {
    accessToken = '',
    baseURI = '',
    seriesId = '',
    title: seriesTitle = '',
    posterUrl = '',
    tmdbId = '',
    totalSize = '',
    seasons: seasonsParam = '[]'
  } = req.query;
  
  let libraryKey = req.query.libraryKey || '';
  let libraryTitle = req.query.libraryTitle || '';
  
  // console.log('[/series] libraryKey recibido:', libraryKey);
  // console.log('[/series] libraryTitle recibido:', libraryTitle);
  
  // Parsear temporadas
  let seasons = [];
  try {
    seasons = JSON.parse(seasonsParam);
  } catch (e) {
    console.error('Error parsing seasons:', e);
  }
  
  // Calcular tamaño total de todas las temporadas
  let calculatedTotalSize = totalSize;
  if ((!totalSize || totalSize === '') && seasons.length > 0 && accessToken && baseURI) {
    // console.log('[/series] Calculando tamaño total de la serie...');
    let totalBytes = 0;
    
    for (const season of seasons) {
      try {
        const seasonUrl = `${baseURI}/library/metadata/${season.ratingKey}/children?X-Plex-Token=${accessToken}`;
        const seasonXml = await httpsGetXML(seasonUrl);
        const parsedSeasonData = parseXML(seasonXml);
        
        // Extraer libraryKey y libraryTitle del primer resultado si no se proporcionaron
        if (!libraryKey && parsedSeasonData.MediaContainer.librarySectionID) {
          libraryKey = parsedSeasonData.MediaContainer.librarySectionID;
          console.log('[/series] libraryKey extraído del XML:', libraryKey);
        }
        if (!libraryTitle && parsedSeasonData.MediaContainer.librarySectionTitle) {
          libraryTitle = parsedSeasonData.MediaContainer.librarySectionTitle;
          console.log('[/series] libraryTitle extraído del XML:', libraryTitle);
        }
        
        // Extraer todos los tamaños de los episodios
        const sizeMatches = seasonXml.match(/size="(\d+)"/g);
        if (sizeMatches) {
          for (const sizeMatch of sizeMatches) {
            const bytes = parseInt(sizeMatch.match(/\d+/)[0]);
            totalBytes += bytes;
          }
        }
      } catch (error) {
        console.error(`[/series] Error calculando tamaño de temporada ${season.title}:`, error);
      }
    }
    
    if (totalBytes > 0) {
      const gb = totalBytes / (1024 * 1024 * 1024);
      calculatedTotalSize = gb >= 1 ? gb.toFixed(2) + ' GB' : (gb * 1024).toFixed(2) + ' MB';
      // console.log('[/series] Tamaño total calculado:', calculatedTotalSize);
    }
  }
  
  // Obtener datos de TMDB
  let seriesData = null;
  let autoSearchedTmdbId = '';
  
  if (tmdbId && tmdbId.trim() !== '') {
    // console.log('[/series] Llamando a fetchTMDBSeriesData con tmdbId:', tmdbId);
    seriesData = await fetchTMDBSeriesData(tmdbId);
    // console.log('[/series] seriesData obtenido:', seriesData ? 'SI' : 'NO');
  } else if (seriesTitle) {
    // Decodificar HTML entities en el título antes de buscar
    const decodedTitle = decodeHtmlEntities(seriesTitle);
    
    // Búsqueda automática en TMDB por título
    // console.log('[/series] NO hay tmdbId - buscando automáticamente en TMDB:', decodedTitle);
    try {
      const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(decodedTitle)}`;
      const searchResults = await httpsGet(searchUrl);
      
      if (searchResults && searchResults.results && searchResults.results.length > 0) {
        // Tomar el primer resultado
        const firstResult = searchResults.results[0];
        autoSearchedTmdbId = firstResult.id.toString();
        // console.log('[/series] ✅ TMDB ID encontrado automáticamente:', autoSearchedTmdbId, '- Título:', firstResult.name);
        
        // Obtener datos completos con el ID encontrado
        seriesData = await fetchTMDBSeriesData(autoSearchedTmdbId);
        // console.log('[/series] seriesData obtenido por búsqueda automática');
      } else {
        // console.log('[/series] ⚠️ No se encontraron resultados en TMDB para:', decodedTitle);
      }
    } catch (error) {
      console.error('[/series] Error en búsqueda automática de TMDB:', error);
    }
  } else {
    // console.log('[/series] NO SE RECIBIÓ tmdbId ni título válido');
  }
  
  // Usar poster y backdrop de TMDB si están disponibles
  const seriesPoster = (seriesData && seriesData.posterPath) || posterUrl || '';
  const seriesBackdrop = (seriesData && seriesData.backdropPath) || '';
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${seriesTitle} - Infinity Scrap</title>
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
          color: #e5e5e5;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        
        .modal-content {
          background: #282828;
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          z-index: 999;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        
        .modal-content::-webkit-scrollbar {
          width: 8px;
        }
        
        .modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .modal-content::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        .modal-backdrop-header {
          position: relative;
          background-size: cover;
          background-position: center top;
          background-repeat: no-repeat;
          background-image: url('${seriesBackdrop}');
          min-height: 250px;
          display: flex;
          align-items: flex-end;
          padding: 2.5rem 3.5rem 1.5rem 3.5rem;
          border-radius: 12px 12px 0 0;
        }
        
        .modal-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(40, 40, 40, 0.3) 0%,
            rgba(40, 40, 40, 0.7) 50%,
            #282828 100%
          );
          border-radius: 12px 12px 0 0;
          z-index: 1;
        }
        
        .modal-header-content {
          position: relative;
          z-index: 2;
          width: 100%;
        }
        
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          z-index: 998;
          cursor: pointer;
          backdrop-filter: blur(4px);
        }
        
        .close-button {
          position: absolute;
          top: 1.5rem;
          right: 2rem;
          z-index: 3;
          background: rgba(0, 0, 0, 0.6);
          border: 2px solid rgba(255, 255, 255, 0.3);
          color: white;
          font-size: 2rem;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          line-height: 1;
          padding: 0;
        }
        
        .close-button:hover {
          background: rgba(229, 160, 13, 0.9);
          border-color: #e5a00d;
          transform: scale(1.1);
        }
        
        .modal-title {
          font-size: 3rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9);
          line-height: 1.1;
          color: white;
        }
        
        .modal-tagline {
          color: rgba(255, 255, 255, 0.9);
          font-size: 1.1rem;
          font-style: italic;
          text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8);
          margin-bottom: 1rem;
        }
        
        .modal-badges-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .modal-icons-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-left: auto;
        }
        
        .filesize-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .year-badge,
        .status-badge,
        .seasons-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .rating-badge {
          background: rgba(249, 168, 37, 0.2);
          border: 2px solid #f9a825;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #f9a825;
          font-weight: 600;
        }
        
        .genres-list {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .genre-tag {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.3rem 0.8rem;
          border-radius: 15px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.9);
          transition: all 0.3s ease;
        }
        
        .badge-icon-link {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }
        
        .badge-icon-link:hover {
          transform: scale(1.1);
        }
        
        .badge-icon {
          height: 32px;
          width: 32px;
          object-fit: contain;
        }
        
        .modal-hero {
          padding: 2rem 3.5rem;
          display: flex;
          gap: 2rem;
        }
        
        .modal-poster-container {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .modal-poster-hero {
          width: 280px;
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        
        .modal-poster-hero img {
          width: 100%;
          height: auto;
          display: block;
        }
        
        .modal-main-info {
          flex: 1;
        }
        
        .modal-details-table {
          display: grid;
          grid-template-columns: 1fr;
          justify-content: space-between;
          gap: 0;
          margin-bottom: 1rem;
          background: rgba(255, 255, 255, 0.07);
          padding: 0.5rem;
          border-radius: 8px;
        }
        
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(229, 160, 13, 0.08);
        }
        
        .detail-item:last-child {
          border-bottom: none;
        }
        
        .detail-item strong {
          color: #e5e5e5;
          font-weight: 600;
        }
        
        .detail-item span {
          color: #e5e5e5;
          text-align: right;
        }
        
        .synopsis-container {
          position: relative;
        }
        
        .modal-synopsis {
          line-height: 1.7;
          font-size: 1.08rem;
          text-align: justify;
          margin-bottom: 0.5rem;
          color: #cccccc;
          max-height: 5.1em;
          overflow: hidden;
          transition: max-height 0.3s ease;
          position: relative;
        }
        
        .modal-synopsis.expanded {
          max-height: none;
        }
        
        .synopsis-toggle {
          background: transparent;
          border: none;
          color: #e5a00d;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          transition: color 0.2s ease;
          text-decoration: underline;
          display: none;
        }
        
        .synopsis-toggle:hover {
          color: #f0b825;
        }
        
        .seasons-section {
          padding: 2rem 3.5rem;
          background: rgba(0, 0, 0, 0.2);
        }
        
        .seasons-title {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
          color: #e5a00d;
        }
        
        .seasons-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 1.5rem;
        }
        
        .season-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s ease;
          border: 2px solid transparent;
        }
        
        .season-card:hover {
          transform: translateY(-4px);
          border-color: #e5a00d;
          box-shadow: 0 8px 24px rgba(229, 160, 13, 0.3);
        }
        
        .season-poster {
          width: 100%;
          aspect-ratio: 2/3;
          object-fit: cover;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .season-info {
          padding: 1rem;
        }
        
        .season-name {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #fff;
        }
        
        .season-episodes {
          font-size: 0.85rem;
          color: #999;
        }
        
        @media (max-width: 768px) {
          .modal-hero {
            flex-direction: column;
            padding: 1.5rem;
          }
          
          .modal-poster-hero {
            width: 100%;
            max-width: 300px;
            margin: 0 auto;
          }
          
          .modal-backdrop-header {
            padding: 2rem 1.5rem 1rem;
          }
          
          .modal-title {
            font-size: 2rem;
          }
          
          .modal-badges-container {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          
          .modal-icons-row {
            margin-left: 0;
          }
          
          .seasons-section {
            padding: 1.5rem;
          }
          
          .seasons-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 1rem;
          }
          
          .detail-item {
            flex-direction: column;
            gap: 0.3rem;
          }
          
          .detail-item strong {
            min-width: auto;
          }
        }
      </style>
    </head>
    <body>
      <div class="modal-overlay" onclick="window.location.href='/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=${encodeURIComponent(libraryKey)}&libraryTitle=${encodeURIComponent(libraryTitle)}&libraryType=show'"></div>
      <div class="modal-content">
        <!-- Header con backdrop -->
        <div class="modal-backdrop-header">
          <button class="close-button" onclick="window.location.href='/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=${encodeURIComponent(libraryKey)}&libraryTitle=${encodeURIComponent(libraryTitle)}&libraryType=show'" title="Cerrar">&times;</button>
          <div class="modal-backdrop-overlay"></div>
          <div class="modal-header-content">
            <h1 class="modal-title">${seriesTitle}</h1>
            ${seriesData && seriesData.tagline ? `<div class="modal-tagline">${seriesData.tagline}</div>` : ''}
            <div class="modal-badges-container">
              <div class="modal-badges-row">
                ${calculatedTotalSize ? `<span class="filesize-badge">${calculatedTotalSize}</span>` : ''}
                ${seriesData && seriesData.year ? `<span class="year-badge">${seriesData.year}</span>` : ''}
                ${seriesData && seriesData.status ? `<span class="status-badge">${seriesData.status}</span>` : ''}
                ${seriesData && seriesData.rating !== 'N/A' ? `
                  <span class="rating-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    ${seriesData.rating}
                  </span>
                ` : ''}
                ${seriesData && seriesData.genres && seriesData.genres.length > 0 ? `
                  <div class="genres-list">
                    ${seriesData.genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
              <div class="modal-icons-row">
                ${tmdbId || autoSearchedTmdbId ? `
                  <a href="https://www.themoviedb.org/tv/${tmdbId || autoSearchedTmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" class="badge-icon">
                  </a>
                ` : ''}
                ${seriesData && seriesData.imdbId ? `
                  <a href="https://www.imdb.com/title/${seriesData.imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" class="badge-icon">
                  </a>
                ` : ''}
                ${seriesData && seriesData.trailerKey ? `
                  <a href="https://www.youtube.com/watch?v=${seriesData.trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" class="badge-icon-link">
                    <img loading="lazy" src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" class="badge-icon">
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Hero con poster e info -->
        <div class="modal-hero">
          <div class="modal-poster-container">
            <div class="modal-poster-hero">
              <img loading="lazy" src="${seriesPoster}" alt="${seriesTitle}" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg';">
            </div>
          </div>
          
          <div class="modal-main-info">
            ${seriesData ? `
              <div class="modal-details-table">
                <div class="detail-item"><strong>Título original:</strong> <span>${seriesData.originalTitle}</span></div>
                <div class="detail-item"><strong>Primera emisión:</strong> <span>${seriesData.firstAirDate}</span></div>
                <div class="detail-item"><strong>Última emisión:</strong> <span>${seriesData.lastAirDate}</span></div>
                <div class="detail-item"><strong>Plataforma:</strong> <span>${seriesData.networks}</span></div>
                <div class="detail-item"><strong>Creadores:</strong> <span>${seriesData.creators}</span></div>
                <div class="detail-item"><strong>Reparto:</strong> <span>${seriesData.cast}</span></div>
                <div class="detail-item"><strong>Número de temporadas:</strong> <span>${seriesData.numberOfSeasons}</span></div>
                <div class="detail-item"><strong>Número de episodios:</strong> <span>${seriesData.numberOfEpisodes}</span></div>
              </div>
              <div class="synopsis-container">
                <div class="modal-synopsis" id="synopsis-text">
                  ${seriesData.overview}
                </div>
                <button class="synopsis-toggle" id="synopsis-toggle" onclick="toggleSynopsis()">Ver más</button>
              </div>
            ` : `
              <div class="synopsis-container">
                <div class="modal-synopsis">
                  Serie lista para ver. Selecciona una temporada abajo.
                </div>
              </div>
            `}
          </div>
        </div>
        
        <!-- Sección de temporadas -->
        <div class="seasons-section">
          <h2 class="seasons-title">Temporadas</h2>
          <div class="seasons-grid">
            ${seasons.map(season => `
              <div class="season-card" onclick="goToSeason('${season.ratingKey}', '${accessToken}', '${baseURI}', '${season.seasonNumber}', '${encodeURIComponent(seriesTitle)}', '${tmdbId || autoSearchedTmdbId}', '${seriesId}', '${libraryKey}', '${libraryTitle}')">
                <img loading="lazy" src="${season.thumb || posterUrl}" alt="${season.title}" class="season-poster" onerror="if(this.src !== '${posterUrl}') { this.src='${posterUrl}'; } else { this.src='https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg'; this.onerror=null; }">
                <div class="season-info">
                  <div class="season-name">${season.title}</div>
                  <div class="season-episodes">${season.episodeCount} episodios</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <script>
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            if (synopsis.classList.contains('expanded')) {
              synopsis.classList.remove('expanded');
              button.textContent = 'Ver más';
            } else {
              synopsis.classList.add('expanded');
              button.textContent = 'Ver menos';
            }
          }
        }
        
        // Detectar si el texto necesita "Ver más" al cargar
        window.addEventListener('load', function() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            // Verificar si el contenido se desborda
            if (synopsis.scrollHeight > synopsis.clientHeight) {
              button.style.display = 'inline-block';
            }
          }
        });
        
        // **SINCRONIZACIÓN DE RATING CON LOCALSTORAGE (SERIES)**
        (function syncRatingWithLocalStorage() {
          const tmdbIdUsed = '${tmdbId || autoSearchedTmdbId}';
          if (!tmdbIdUsed) return;
          
          // PRIORIDAD 1: Si Plex tiene rating, NO hacer nada (ya está en el HTML)
          const plexHasRating = ${seriesData && seriesData.rating !== 'N/A' ? 'true' : 'false'};
          if (plexHasRating) {
            console.log('[RATING] Usando rating de Plex, no consultando TMDB');
            return; // El badge ya está en el HTML renderizado
          }
          
          // PRIORIDAD 2: Verificar si YA existe el badge en el DOM
          const badgesRow = document.querySelector('.modal-badges-row');
          const existingRating = badgesRow ? badgesRow.querySelector('.rating-badge') : null;
          if (existingRating) {
            console.log('[RATING] Badge ya existe en el DOM, saltando');
            return; // Ya hay un badge, no crear duplicado
          }
          
          // PRIORIDAD 3: Buscar en localStorage
          const cacheKey = \`tmdb_rating_tv_\${tmdbIdUsed}\`;
          const cachedRating = localStorage.getItem(cacheKey);
          
          if (cachedRating && cachedRating !== '0' && cachedRating !== '0.0') {
            console.log('[RATING] Encontrado en localStorage:', cachedRating);
            // Crear badge con rating de localStorage
            if (badgesRow) {
              const ratingBadge = document.createElement('span');
              ratingBadge.className = 'rating-badge';
              ratingBadge.innerHTML = \`
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                </svg>
                \${cachedRating}
              \`;
              badgesRow.insertBefore(ratingBadge, badgesRow.querySelector('.genres-list'));
            }
            return;
          }
          
          // PRIORIDAD 3: Consultar TMDB
          console.log('Consultando rating de TMDB para serie:', tmdbIdUsed);
          fetch(\`https://api.themoviedb.org/3/tv/\${tmdbIdUsed}?api_key=${TMDB_API_KEY}\`)
            .then(res => res.json())
            .then(data => {
              if (data.vote_average) {
                const rating = data.vote_average.toFixed(1);
                console.log('Rating TMDB obtenido:', rating);
                localStorage.setItem(cacheKey, rating);
                
                // Crear o actualizar el rating badge
                const badgesRow = document.querySelector('.modal-badges-row');
                if (badgesRow) {
                  const existingRating = badgesRow.querySelector('.rating-badge');
                  if (!existingRating) {
                    const ratingBadge = document.createElement('span');
                    ratingBadge.className = 'rating-badge';
                    ratingBadge.innerHTML = \`
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                      </svg>
                      \${rating}
                    \`;
                    badgesRow.insertBefore(ratingBadge, badgesRow.querySelector('.genres-list'));
                  }
                }
              }
            })
            .catch(err => console.error('Error fetching TMDB rating:', err));
        })();
        
        function goToSeason(seasonRatingKey, accessToken, baseURI, seasonNumber, seriesTitle, tmdbId, parentRatingKey, libraryKey, libraryTitle) {
          // Redirigir a la página /list con los datos de la temporada
          const params = new URLSearchParams();
          params.set('accessToken', accessToken);
          params.set('baseURI', baseURI);
          params.set('seasonRatingKey', seasonRatingKey);
          params.set('seasonNumber', seasonNumber);
          params.set('seriesTitle', decodeURIComponent(seriesTitle));
          params.set('parentRatingKey', parentRatingKey || seasonRatingKey);
          if (tmdbId) params.set('tmdbId', tmdbId);
          if (libraryKey) params.set('libraryKey', libraryKey);
          if (libraryTitle) params.set('libraryTitle', libraryTitle);
          
          window.location.href = '/list?' + params.toString();
        }
      </script>
    </body>
    </html>
  `);
});

// Ruta API para obtener datos de temporadas
app.get('/api/seasons', async (req, res) => {
  const { accessToken, baseURI, seriesId } = req.query;
  
  if (!accessToken || !baseURI || !seriesId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const seriesUrl = `${baseURI}/library/metadata/${seriesId}?X-Plex-Token=${accessToken}`;
    const seriesXmlData = await httpsGetXML(seriesUrl);
    
    // Parsear XML para obtener información básica de la serie
    const titleMatch = seriesXmlData.match(/title="([^"]*)"/);
    const thumbMatch = seriesXmlData.match(/thumb="([^"]*)"/);
    const seriesTitle = titleMatch ? titleMatch[1] : '';
    const thumb = thumbMatch ? thumbMatch[1] : '';
    const posterUrl = thumb ? `${baseURI}${thumb}?X-Plex-Token=${accessToken}` : '';
    
    // Obtener temporadas
    const seasonsUrl = `${baseURI}/library/metadata/${seriesId}/children?X-Plex-Token=${accessToken}`;
    const seasonsXmlData = await httpsGetXML(seasonsUrl);
    
    const seasonRegex = /<Directory[^>]*type="season"[^>]*>/g;
    const seasonMatches = [...seasonsXmlData.matchAll(seasonRegex)];
    
    const seasons = [];
    let totalSizeBytes = 0;
    
    for (const match of seasonMatches) {
      const seasonTag = match[0];
      
      const indexMatch = seasonTag.match(/index="([^"]*)"/);
      const titleMatch = seasonTag.match(/title="([^"]*)"/);
      const thumbMatch = seasonTag.match(/thumb="([^"]*)"/);
      const keyMatch = seasonTag.match(/key="([^"]*)"/);
      const ratingKeyMatch = seasonTag.match(/ratingKey="([^"]*)"/);
      const leafCountMatch = seasonTag.match(/leafCount="([^"]*)"/);
      
      const seasonIndex = indexMatch ? indexMatch[1] : '0';
      const seasonTitle = titleMatch ? titleMatch[1] : `Temporada ${seasonIndex}`;
      const seasonThumb = thumbMatch ? thumbMatch[1] : '';
      const seasonKey = keyMatch ? keyMatch[1] : '';
      const seasonRatingKey = ratingKeyMatch ? ratingKeyMatch[1] : '';
      const leafCount = leafCountMatch ? leafCountMatch[1] : '0';
      
      const seasonPosterUrl = seasonThumb ? `${baseURI}${seasonThumb}?X-Plex-Token=${accessToken}` : '';
      
      // Obtener episodios para calcular tamaño
      const episodesUrl = `${baseURI}${seasonKey}?X-Plex-Token=${accessToken}`;
      const episodesXmlData = await httpsGetXML(episodesUrl);
      
      const sizeRegex = /<Part[^>]*size="([^"]*)"/g;
      const sizeMatches = [...episodesXmlData.matchAll(sizeRegex)];
      
      for (const sizeMatch of sizeMatches) {
        const size = parseInt(sizeMatch[1], 10);
        if (!isNaN(size)) {
          totalSizeBytes += size;
        }
      }
      
      seasons.push({
        index: seasonIndex,
        title: seasonTitle,
        poster: seasonPosterUrl,
        key: seasonKey,
        ratingKey: seasonRatingKey,
        episodeCount: leafCount
      });
    }
    
    // Calcular tamaño total
    let totalSize = '';
    if (totalSizeBytes > 0) {
      const gb = totalSizeBytes / (1024 * 1024 * 1024);
      const tb = gb / 1024;
      totalSize = tb >= 1 ? tb.toFixed(2) + ' TB' : gb.toFixed(2) + ' GB';
    }
    
    res.json({
      title: seriesTitle,
      posterUrl: posterUrl,
      totalSize: totalSize,
      seasons: seasons
    });
    
  } catch (error) {
    console.error('Error fetching seasons:', error);
    res.status(500).json({ error: 'Error fetching seasons data' });
  }
});

// Ruta para explorar contenido de una biblioteca
app.get('/browse', async (req, res) => {
  const { accessToken, baseURI, libraryKey, libraryTitle, libraryType } = req.query;
  
  if (!accessToken || !baseURI || !libraryKey) {
    return res.status(400).send('Faltan parámetros requeridos');
  }
  
  try {
    // Obtener contenido de la biblioteca
    const contentUrl = `${baseURI}/library/sections/${libraryKey}/all?X-Plex-Token=${accessToken}`;
    const xmlData = await httpsGetXML(contentUrl);
    
    // Extraer items (películas o series) con todos sus metadatos, géneros, colecciones y países
    const items = [];
    const tagType = libraryType === 'movie' ? 'Video' : 'Directory';
    const allGenres = new Set();
    const allCollections = new Set();
    const allCountries = new Set();
    
    // Extraer todos los géneros disponibles en la biblioteca
    const genreMatches = xmlData.matchAll(/<Genre[^>]*tag="([^"]*)"[^>]*>/g);
    for (const match of genreMatches) {
      allGenres.add(match[1]);
    }
    
    // Extraer todas las colecciones
    const collectionMatches = xmlData.matchAll(/<Collection[^>]*tag="([^"]*)"[^>]*>/g);
    for (const match of collectionMatches) {
      allCollections.add(match[1]);
    }
    
    // Extraer todos los países
    const countryMatches = xmlData.matchAll(/<Country[^>]*tag="([^"]*)"[^>]*>/g);
    for (const match of countryMatches) {
      allCountries.add(match[1]);
    }
    
    // Extraer items con géneros, colecciones y países
    const videoSections = xmlData.split(`<${tagType}`).slice(1);
    for (const section of videoSections) {
      const fullTag = `<${tagType}${section.split('>')[0]}>`;
      const contentUntilEnd = section.split(`</${tagType}>`)[0];
      
      const ratingKeyMatch = fullTag.match(/ratingKey="([^"]*)"/);
      const titleMatch = fullTag.match(/title="([^"]*)"/);
      const yearMatch = fullTag.match(/year="([^"]*)"/);
      const thumbMatch = fullTag.match(/thumb="([^"]*)"/);
      const tmdbMatch = fullTag.match(/guid="[^"]*tmdb:\/\/(\d+)/i);
      const audienceRatingMatch = fullTag.match(/audienceRating="([^"]*)"/);
      const ratingMatch = audienceRatingMatch || fullTag.match(/rating="([^"]*)"/);
      const summaryMatch = fullTag.match(/summary="([^"]*)"/);
      const addedAtMatch = fullTag.match(/addedAt="([^"]*)"/);
      
      if (ratingKeyMatch && titleMatch) {
        // Extraer géneros de este item
        const itemGenres = [];
        const genreItemMatches = contentUntilEnd.matchAll(/<Genre[^>]*tag="([^"]*)"[^>]*>/g);
        for (const gMatch of genreItemMatches) {
          itemGenres.push(gMatch[1]);
        }
        
        // Extraer colecciones de este item
        const itemCollections = [];
        const collectionItemMatches = contentUntilEnd.matchAll(/<Collection[^>]*tag="([^"]*)"[^>]*>/g);
        for (const cMatch of collectionItemMatches) {
          itemCollections.push(cMatch[1]);
        }
        
        // Extraer países de este item
        const itemCountries = [];
        const countryItemMatches = contentUntilEnd.matchAll(/<Country[^>]*tag="([^"]*)"[^>]*>/g);
        for (const coMatch of countryItemMatches) {
          itemCountries.push(coMatch[1]);
        }
        
        items.push({
          ratingKey: ratingKeyMatch[1],
          title: titleMatch[1],
          year: yearMatch ? yearMatch[1] : '',
          thumb: thumbMatch ? `${baseURI}${thumbMatch[1]}?X-Plex-Token=${accessToken}` : '',
          tmdbId: tmdbMatch ? tmdbMatch[1] : '',
          rating: ratingMatch ? parseFloat(ratingMatch[1]).toFixed(1) : '0',
          summary: summaryMatch ? summaryMatch[1] : '',
          addedAt: addedAtMatch ? parseInt(addedAtMatch[1]) : 0,
          genres: itemGenres,
          collections: itemCollections,
          countries: itemCountries
        });
      }
    }

    // Obtener listas únicas para filtros
    const uniqueYears = [...new Set(items.map(i => i.year).filter(y => y))].sort((a, b) => b - a);
    const uniqueGenres = Array.from(allGenres).sort();
    const uniqueCollections = Array.from(allCollections).sort();
    const uniqueCountries = Array.from(allCountries).sort();
    
    // Extraer estadísticas del XML
    let totalSizeBytes = 0;
    // Extraer size solo de archivos dentro de Video tags (no thumbnails)
    const videoTags = xmlData.split('<Video').slice(1);
    for (const videoSection of videoTags) {
      const videoEnd = videoSection.indexOf('</Video>');
      if (videoEnd === -1) continue;
      const videoContent = videoSection.substring(0, videoEnd);
      const sizeMatches = videoContent.matchAll(/<Part[^>]*size="([^"]*)"[^>]*>/g);
      for (const match of sizeMatches) {
        totalSizeBytes += parseInt(match[1]) || 0;
      }
    }
    const totalSizeGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
    const totalSizeTB = (totalSizeBytes / (1024 * 1024 * 1024 * 1024)).toFixed(2);
    const totalSizeFormatted = totalSizeBytes >= 1024 * 1024 * 1024 * 1024 
      ? `${totalSizeTB} TB` 
      : `${totalSizeGB} GB`;
    
    // Calcular duración total
    let totalDurationMs = 0;
    const durationMatches = xmlData.matchAll(/duration="([^"]*)"/g);
    for (const match of durationMatches) {
      totalDurationMs += parseInt(match[1]) || 0;
    }
    const totalHours = Math.floor(totalDurationMs / (1000 * 60 * 60));
    const totalDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    const durationFormatted = totalDays > 0 
      ? `${totalDays}d ${remainingHours}h` 
      : `${totalHours}h`;
    
    // Para series: contar temporadas (childCount tiene el número de temporadas por serie)
    let totalSeasons = 0;
    let totalEpisodes = 0;
    if (libraryType === 'show') {
      const childCountMatches = xmlData.matchAll(/childCount="([^"]*)"/g);
      const leafCountMatches = xmlData.matchAll(/leafCount="([^"]*)"/g);
      for (const match of childCountMatches) {
        totalSeasons += parseInt(match[1]) || 0;
      }
      for (const match of leafCountMatches) {
        totalEpisodes += parseInt(match[1]) || 0;
      }
    }
    
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes, minimum-scale=1.0, maximum-scale=5.0">
        <meta name="theme-color" content="#e5a00d">
        <meta name="description" content="Biblioteca de ${libraryTitle}">
        <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
        <title>${libraryTitle} - Infinity Scrap</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary-color: #e5a00d;
            --primary-dark: #c28a0b;
            --bg-dark: #0f0f0f;
            --bg-secondary: #1a1a1a;
            --text-primary: #ffffff;
            --text-secondary: #b3b3b3;
            --border-color: rgba(255, 255, 255, 0.1);
            --card-size: 180px;
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html { scroll-behavior: smooth; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg-dark);
            color: var(--text-primary);
            min-height: 100vh;
          }
          .container { max-width: 1400px; margin: 0 auto; padding: 0 1.5rem; }
          .navbar {
            background: rgba(31, 41, 55, 0.95);
            backdrop-filter: blur(20px);
            padding: 1rem 0;
            border-bottom: 1px solid rgba(229, 160, 13, 0.2);
            position: sticky;
            top: 0;
            z-index: 1000;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 2rem;
          }
          .nav-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .back-button {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            background: rgba(229, 160, 13, 0.1);
            border: 1px solid rgba(229, 160, 13, 0.3);
            border-radius: 8px;
            color: #e5a00d;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
          }
          .back-button:hover {
            background: rgba(229, 160, 13, 0.2);
            transform: translateX(-4px);
          }
          .library-header {
            padding: 2rem 0;
          }
          .library-header h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 1rem;
          }
          .search-form {
            display: flex;
            gap: 1rem;
          }
          .search-input {
            flex: 1;
            padding: 0.75rem 1rem;
            background: rgba(31, 41, 55, 0.8);
            border: 1px solid rgba(229, 160, 13, 0.2);
            border-radius: 8px;
            color: #f3f4f6;
            font-size: 1rem;
          }
          .search-input:focus {
            outline: none;
            border-color: #e5a00d;
          }
          .search-btn {
            padding: 0.75rem 1.5rem;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            border: none;
            border-radius: 8px;
            color: #000;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
          }
          .search-btn:hover {
            transform: translateY(-2px);
          }
          .info-row {
            display: flex;
            gap: 2rem;
            color: #9ca3af;
            font-size: 0.875rem;
          }
          .movie-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 1.5rem;
            padding: 2rem 0;
          }
          .movie-card {
            cursor: pointer;
            transition: transform 0.3s ease;
          }
          .movie-card:hover {
            transform: translateY(-8px);
          }
          .poster {
            width: 100%;
            aspect-ratio: 2/3;
            border-radius: 12px;
            object-fit: cover;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            margin-bottom: 0.75rem;
            background: rgba(31, 41, 55, 0.5);
          }
          .movie-title {
            font-size: 0.875rem;
            font-weight: 600;
            margin-bottom: 0.25rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .movie-year {
            font-size: 0.75rem;
            color: #9ca3af;
          }
          .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 1rem;
            padding: 2rem 0;
          }
          .page-btn {
            padding: 0.5rem 1rem;
            background: rgba(229, 160, 13, 0.1);
            border: 1px solid rgba(229, 160, 13, 0.3);
            border-radius: 8px;
            color: #e5a00d;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
          }
          .page-btn:hover {
            background: rgba(229, 160, 13, 0.2);
          }
          .page-info {
            color: #9ca3af;
          }
          /* Navbar styles */
          .navbar { background: #000; padding: 0.5rem 0; border-bottom: 1px solid rgba(229, 160, 13, 0.2); position: sticky; top: 0; z-index: 1000; backdrop-filter: blur(10px); }
          .navbar .container { padding: 0 1rem; }
          .nav-content { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
          .navbar-brand { text-decoration: none; color: var(--text-primary); display: flex; align-items: center; }
          .logo-title { color: var(--primary-color); font-size: 1.5rem; font-weight: 700; white-space: nowrap; }
          .navbar-links { display: flex; gap: 0.25rem; align-items: center; flex-wrap: nowrap; flex: 1; justify-content: center; }
          .navbar-links #library-links { display: flex; gap: 0.25rem; align-items: center; flex-wrap: nowrap; }
          .navbar-links a { color: var(--text-secondary); text-decoration: none; font-weight: 500; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap; padding: 0.5rem 0.65rem; border-radius: 6px; font-size: 0.875rem; }
          .navbar-links a:hover { color: var(--primary-color); background: rgba(229, 160, 13, 0.1); }
          .navbar-links a.active { color: var(--primary-color); background: rgba(229, 160, 13, 0.15); font-weight: 600; }
          .navbar-controls { display: flex; gap: 1rem; align-items: center; }
          
          /* Mobile Search Bar */
          .mobile-search-bar {
            display: none;
            background: var(--bg-secondary);
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border-color);
            position: relative;
            z-index: 998;
          }

          .mobile-search-wrapper {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }

          .mobile-search-wrapper input {
            flex: 1;
            background: var(--bg-dark);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.875rem 1rem;
            color: var(--text-primary);
            font-size: 0.9375rem;
            text-align: center;
            font-weight: 500;
            transition: text-align 0.2s ease;
            cursor: pointer;
          }

          .mobile-search-wrapper input:focus {
            outline: none;
            border-color: var(--primary-color);
            text-align: left;
            cursor: text;
          }

          .mobile-search-wrapper input::placeholder {
            color: var(--primary-color);
            opacity: 1;
            font-weight: 600;
            text-align: center;
          }

          .mobile-search-wrapper input:focus::placeholder {
            opacity: 0;
          }

          .mobile-search-btn,
          .mobile-filter-btn {
            background: var(--primary-color);
            border: none;
            width: 44px;
            height: 44px;
            border-radius: 8px;
            color: #000;
            font-size: 1.125rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
          }

          .mobile-search-btn:hover,
          .mobile-filter-btn:hover {
            background: var(--primary-dark);
          }

          /* Filters Overlay */
          .filters-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            z-index: 1999;
            opacity: 0;
            transition: opacity 0.3s ease;
          }

          .filters-overlay.active {
            display: block;
            opacity: 1;
          }

          /* Mobile Filters Sidebar */
          .filters-sidebar {
            position: fixed;
            top: 0;
            right: -100%;
            width: 85%;
            max-width: 350px;
            height: 100vh;
            background: var(--bg-secondary);
            z-index: 2000;
            transition: right 0.3s ease;
            overflow: hidden;
            box-shadow: -4px 0 12px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
          }

          .filters-sidebar.active {
            right: 0;
          }

          .filters-sidebar-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.25rem;
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            background: var(--bg-secondary);
            z-index: 10;
          }

          .filters-sidebar-header h3 {
            color: var(--text-primary);
            font-size: 1.1rem;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .filters-sidebar-close {
            background: none;
            border: none;
            color: var(--text-primary);
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0.25rem;
            transition: color 0.2s;
          }

          .filters-sidebar-close:hover {
            color: var(--primary-color);
          }

          .filters-sidebar-content {
            padding: 1rem 1.25rem;
            overflow-y: auto;
            flex: 1;
            -webkit-overflow-scrolling: touch;
          }

          .filter-section {
            margin-bottom: 1rem;
          }

          .filter-section-title {
            color: var(--text-secondary);
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
            font-weight: 600;
          }

          .filter-section select {
            width: 100%;
            background: var(--bg-dark);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.65rem 0.85rem;
            color: var(--text-primary);
            font-size: 0.9rem;
          }

          .filter-section select:focus {
            outline: none;
            border-color: var(--primary-color);
          }

          .sidebar-search-box {
            position: relative;
            width: 100%;
          }

          .sidebar-search-box input {
            width: 100%;
            background: var(--bg-dark);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 0.65rem 2.5rem 0.65rem 0.85rem;
            color: var(--text-primary);
            font-size: 0.9rem;
          }

          .sidebar-search-box input:focus {
            outline: none;
            border-color: var(--primary-color);
          }

          .sidebar-search-box i {
            position: absolute;
            right: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-secondary);
            pointer-events: none;
          }

          .sidebar-clear-btn {
            width: 100%;
            background: var(--primary-color);
            border: none;
            color: #000;
            padding: 0.65rem;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 1rem;
            font-size: 0.9rem;
          }

          .sidebar-clear-btn:hover {
            background: var(--primary-dark);
            transform: scale(1.02);
          }
          
          /* Botones de vista en sidebar móvil */
          .sidebar-view-buttons {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
          }
          .sidebar-view-btn {
            flex: 1;
            background: var(--bg-dark);
            border: 2px solid var(--border-color);
            color: var(--text-secondary);
            padding: 0.65rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-weight: 600;
            font-size: 0.85rem;
          }
          .sidebar-view-btn:hover {
            border-color: var(--primary-color);
            color: var(--primary-color);
            background: rgba(229, 160, 13, 0.05);
          }
          .sidebar-view-btn.active {
            background: var(--primary-color);
            border-color: var(--primary-color);
            color: #000;
          }

          /* Dropdown moderno */
          .dropdown-container { position: relative; display: inline-flex; z-index: 2200; }
          .more-btn { background: var(--bg-dark); border: 1px solid var(--border-color); color: var(--text-primary); padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; transition: all 0.2s; white-space: nowrap; z-index: 2200; }
          .more-btn:hover { color: var(--primary-color); border-color: var(--primary-color); background: rgba(229, 160, 13, 0.05); }
          .more-btn.active { color: var(--primary-color); background: rgba(229, 160, 13, 0.1); border-color: var(--primary-color); }
          .more-btn i { transition: transform 0.2s; font-size: 0.7rem; }
          .more-btn.active i { transform: rotate(180deg); }
          .dropdown-menu { position: absolute; top: calc(100% + 0.5rem); right: 0; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; min-width: 200px; max-width: 90vw; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 2200; opacity: 0; visibility: hidden; transform: translateY(-10px); transition: all 0.2s; max-height: 80vh; overflow-y: auto; }
          .dropdown-menu.show { opacity: 1; visibility: visible; transform: translateY(0); }
          .dropdown-menu a { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: var(--text-secondary); text-decoration: none; transition: all 0.2s; font-size: 0.875rem; border-radius: 0; }
          .dropdown-menu a:hover { background: rgba(229, 160, 13, 0.1); color: var(--primary-color); }
          .dropdown-menu a.active { color: var(--primary-color); font-weight: 600; background: rgba(229, 160, 13, 0.05); }
          .dropdown-menu a i { font-size: 0.875rem; min-width: 1em; }
          
          .search-container { position: relative; display: flex; align-items: center; }
          .search-container input { background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.5rem 2.5rem 0.5rem 1rem; color: var(--text-primary); width: 250px; height: 38px; }
          .search-container input:focus { outline: none; border-color: var(--primary-color); }
          .search-container i { position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-secondary); }
          
          /* Library Controls */
          .library-controls { background: var(--bg-secondary); padding: 0.75rem 0; border-bottom: 1px solid var(--border-color); }
          .controls-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0 0.5rem; }
          
          /* Left: Library Info */
          .library-info { display: flex; align-items: center; gap: 0.5rem; min-width: fit-content; }
          .library-title { font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--primary-color); white-space: nowrap; }
          .library-title i { margin-right: 0.35rem; font-size: 1.1rem; }
          .library-count { font-size: 0.95rem; font-weight: 600; color: var(--primary-color); white-space: nowrap; }
          
          /* Center: Filters Group */
          .filters-group { display: flex; gap: 0.4rem; flex-wrap: nowrap; flex: 1; justify-content: center; align-items: center; }
          .filter-select { background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.4rem 0.65rem; color: var(--text-primary); cursor: pointer; font-size: 0.75rem; min-width: 90px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .filter-select option { white-space: normal; }
          .filter-select:focus { outline: none; border-color: var(--primary-color); }
          .btn-clear-filters { background: var(--primary-color); color: #000; border: none; border-radius: 6px; padding: 0.4rem 0.8rem; cursor: pointer; font-weight: 600; transition: background 0.2s; display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; white-space: nowrap; }
          .btn-clear-filters:hover { background: var(--primary-dark); }
          
          /* Right: View Controls */
          .view-controls { display: flex; gap: 1rem; align-items: center; min-width: fit-content; }
          .grid-size-control { display: flex; align-items: center; gap: 0.75rem; transition: opacity 0.3s, visibility 0.3s; }
          .grid-size-control.hidden { opacity: 0; visibility: hidden; width: 0; overflow: hidden; }
          .grid-size-control i { color: var(--text-secondary); }
          .grid-size-control input[type="range"] { width: 120px; height: 4px; background: var(--bg-dark); border-radius: 2px; outline: none; -webkit-appearance: none; }
          .grid-size-control input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; background: var(--primary-color); cursor: pointer; border-radius: 50%; }
          .grid-size-control input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; background: var(--primary-color); cursor: pointer; border-radius: 50%; border: none; }
          .view-buttons { display: flex; gap: 0.5rem; }
          .view-btn { background: var(--bg-dark); border: 1px solid var(--border-color); padding: 0.5rem 0.75rem; border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: all 0.2s; }
          .view-btn:hover { color: var(--primary-color); border-color: var(--primary-color); }
          .view-btn.active { background: var(--primary-color); color: #000; border-color: var(--primary-color); }
          
          /* Movie grid */
          .main-content { padding: 2rem 0; min-height: 60vh; }
          .movie-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--card-size, 180px), 1fr)); gap: 1.5rem; transition: all 0.3s ease; }
          .movie-grid.list-view { grid-template-columns: 1fr; }
          .movie-card { position: relative; cursor: pointer; transition: all 0.3s ease; border-radius: 8px; overflow: hidden; background: var(--bg-secondary); box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
          .movie-card:hover { transform: translateY(-8px); box-shadow: 0 8px 24px rgba(229, 160, 13, 0.3); }
          
          /* Movie poster */
          .movie-poster { position: relative; overflow: hidden; border-radius: 8px; aspect-ratio: 2/3; }
          .movie-poster img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; display: block; }
          .movie-card:hover .movie-poster img { transform: scale(1.1); }
          .no-poster { width: 100%; height: 100%; background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.875rem; }
          
          /* Episode count badge for series */
          .episode-count-badge { position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(229, 160, 13, 0.95); color: #000; padding: 0.35rem 0.65rem; border-radius: 12px; font-size: 0.75rem; font-weight: 700; z-index: 2; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
          
          /* Movie overlay - Hidden */
          .movie-overlay { display: none; }
          
          /* Movie info - Grid mode (default) */
          .movie-info { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; }
          .movie-title { font-size: 0.875rem; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
          .movie-year { color: var(--text-secondary); font-weight: 500; font-size: 0.75rem; line-height: 1.2; }
          .movie-meta { display: flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; }
          .movie-rating { color: var(--primary-color); letter-spacing: 1px; display: flex; align-items: center; gap: 0.25rem; font-weight: 600; }
          .movie-rating i { font-size: 0.7rem; }
          
          /* Grid mode específico - año en línea separada, ocultar géneros y sinopsis */
          .movie-grid:not(.list-view) .movie-year.grid-only { display: block; }
          .movie-grid:not(.list-view) .movie-year.list-only { display: none; }
          .movie-grid:not(.list-view) .movie-genres { display: none; }
          .movie-grid:not(.list-view) .movie-overview { display: none; }
          
          /* Overlay info */
          .overlay-title { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; color: #fff; line-height: 1.2; }
          .overlay-meta { display: flex; gap: 1rem; margin-bottom: 0.75rem; font-size: 0.75rem; }
          .overlay-year { color: var(--text-secondary); }
          .overlay-rating { color: var(--primary-color); display: flex; align-items: center; gap: 0.25rem; font-weight: 600; }
          .overlay-rating i { font-size: 0.75rem; }
          
          /* Animations */
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          
          /* List view */
          .movie-grid.list-view .movie-card { display: flex; flex-direction: row; align-items: stretch; height: 150px; padding: 0; overflow: hidden; }
          .movie-grid.list-view .movie-poster { aspect-ratio: 2/3; width: 100px; height: 150px; flex-shrink: 0; margin: 0; }
          .movie-grid.list-view .movie-poster img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px 0 0 8px; }
          .movie-grid.list-view .movie-info { padding: 1rem 1.5rem 1.25rem 1.5rem; flex: 1; display: flex; flex-direction: column; justify-content: flex-start; gap: 0.5rem; overflow: hidden; }
          .movie-grid.list-view .movie-title { font-size: 1.25rem; font-weight: 700; order: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .movie-grid.list-view .movie-year.list-only { display: inline; color: var(--text-secondary); font-weight: 400; font-size: 1.25rem; }
          .movie-grid.list-view .movie-year.grid-only { display: none; }
          .movie-grid.list-view .movie-meta { display: flex; flex-direction: row; align-items: center; gap: 1rem; font-size: 0.875rem; order: 2; flex-wrap: nowrap; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; width: 100%; }
          .movie-grid.list-view .movie-rating { color: var(--primary-color); display: flex; align-items: center; gap: 0.35rem; font-weight: 600; flex-shrink: 0; }
          .movie-grid.list-view .movie-genres { color: var(--text-secondary); font-size: 0.875rem; font-weight: 400; display: inline !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
          .movie-grid.list-view .movie-overview { display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; order: 3; opacity: 0.8; text-overflow: ellipsis; }
          .movie-grid.list-view .movie-overlay { display: none; }
          
          /* Responsive */
          
          /* Tablet and below - iPad Pro included */
          @media (max-width: 1024px) {
            .navbar { padding: 0; }
            .navbar .container { padding: 0.75rem 1rem; }
            .nav-content { gap: 0.75rem; flex-wrap: nowrap; }
            .logo-title { font-size: 1.3rem; }
            
            /* Mostrar dropdown "Más" cuando hay muchas bibliotecas */
            .navbar-links { 
              display: flex; 
              gap: 0.5rem;
              flex-wrap: nowrap;
              flex: 1;
              min-width: 0;
            }
            .navbar-links a { 
              padding: 0.5rem 0.75rem; 
              font-size: 0.875rem; 
              white-space: nowrap;
              flex-shrink: 0;
            }
            .navbar-links a i { font-size: 0.875rem; }
            
            .dropdown-container { 
              display: inline-flex !important;
              margin-left: 0.5rem;
            }
            .more-btn { 
              padding: 0.5rem 0.75rem;
              font-size: 0.875rem;
            }
            
            .search-container input { width: 200px; font-size: 0.875rem; }
            
            .library-controls { padding: 0.75rem 0; }
            .controls-row { gap: 0.75rem; }
            .library-title { font-size: 1.1rem; }
            .library-count { font-size: 0.85rem; }
            .filter-select { 
              min-width: 90px; 
              max-width: 120px; 
              font-size: 0.75rem; 
              padding: 0.4rem 0.6rem; 
            }
            .btn-clear-filters { 
              padding: 0.4rem 0.75rem; 
              font-size: 0.75rem; 
            }
            
            .container { padding: 0 1.5rem; }
            .movie-grid { 
              grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); 
              gap: 1.25rem; 
            }
          }
          
          /* Tablet portrait and below */
          @media (max-width: 768px) {
            .mobile-search-bar { display: block; }
            .library-controls { display: none; }
            .search-container { display: none !important; }
            
            .navbar .container { padding: 0.5rem 0.75rem; }
            .nav-content { gap: 0.25rem; }
            .logo-title { font-size: 0.95rem; }
            
            .navbar-links { 
              gap: 0.15rem;
              flex: 1;
              min-width: 0;
            }
            .navbar-links #library-links {
              gap: 0.15rem;
            }
            .navbar-links a { 
              font-size: 0.75rem; 
              padding: 0.35rem 0.4rem;
              flex-shrink: 0;
              gap: 0.3rem;
            }
            .navbar-links a i { font-size: 0.7rem; }
            
            .dropdown-container { margin-left: 0.15rem; }
            .more-btn { 
              font-size: 0.7rem; 
              padding: 0.35rem 0.4rem;
              gap: 0.25rem;
            }
            .more-btn i { font-size: 0.65rem; }
            
            .search-container input { 
              width: 150px; 
              font-size: 0.8rem; 
              padding: 0.4rem 2rem 0.4rem 0.75rem; 
              height: 34px; 
            }
            .search-container i { font-size: 0.8rem; }
            
            .library-controls { padding: 0.75rem 0; }
            .controls-row { 
              flex-direction: column; 
              gap: 0.75rem; 
              align-items: stretch; 
            }
            .library-info { 
              justify-content: space-between; 
              width: 100%; 
            }
            .library-title { font-size: 1.1rem; }
            .library-count { font-size: 0.85rem; }
            
            .filters-group { 
              gap: 0.35rem; 
              flex-wrap: nowrap; 
              overflow-x: auto; 
              scrollbar-width: none; 
              -ms-overflow-style: none; 
              padding: 0 0.25rem; 
            }
            .filters-group::-webkit-scrollbar { display: none; }
            .filter-select { 
              min-width: 110px; 
              flex-shrink: 0; 
              font-size: 0.75rem; 
              padding: 0.4rem 0.6rem; 
            }
            .btn-clear-filters { 
              min-width: 90px; 
              flex-shrink: 0; 
              font-size: 0.75rem; 
              padding: 0.4rem 0.7rem; 
            }
            
            .view-controls { display: none; }
            
            .container { padding: 0 1rem; }
            .movie-grid { 
              grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
              gap: 1rem; 
            }
          }
          
          /* Mobile devices */
          @media (max-width: 540px) {
            .navbar { padding: 0; }
            .navbar .container { padding: 0.5rem 0.75rem; }
            .nav-content { 
              flex-wrap: nowrap;
              gap: 0.5rem;
            }
            .logo-title { font-size: 1.1rem; }
            
            /* Bibliotecas compactas */
            .navbar-links { 
              gap: 0.25rem;
              flex: 1;
              min-width: 0;
            }
            .navbar-links a { 
              font-size: 0.75rem; 
              padding: 0.35rem 0.5rem;
              flex-shrink: 0;
            }
            .navbar-links a i { display: none; }
            
            .dropdown-container { margin-left: 0.25rem; }
            .more-btn { 
              font-size: 0.7rem; 
              padding: 0.35rem 0.5rem; 
            }
            
            .search-container input { 
              width: 120px; 
              font-size: 0.75rem; 
              padding: 0.35rem 1.75rem 0.35rem 0.65rem; 
              height: 32px; 
            }
            .search-container i { 
              right: 0.5rem; 
              font-size: 0.75rem; 
            }
            
            .library-title { font-size: 1rem; }
            .library-title i { font-size: 0.9rem; }
            .library-count { font-size: 0.8rem; }
            
            .filter-select { 
              min-width: 100px; 
              font-size: 0.7rem; 
              padding: 0.35rem 0.5rem; 
            }
            .btn-clear-filters { 
              min-width: 85px; 
              font-size: 0.7rem; 
              padding: 0.35rem 0.6rem; 
            }
            
            .container { padding: 0 0.75rem; }
            .movie-grid { 
              grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); 
              gap: 0.75rem; 
            }
            
            .movie-card { border-radius: 6px; }
            .movie-poster { border-radius: 6px; }
            .movie-info { padding: 0.5rem; }
            .movie-title { font-size: 0.8rem; }
            .movie-year { font-size: 0.675rem; }
            .movie-meta { font-size: 0.675rem; }
          }
          
          /* Extra small devices */
          @media (max-width: 480px) {
            .logo-title { font-size: 1rem; }
            
            .navbar-links { 
              flex: 1;
              min-width: 0;
            }
            .navbar-links a { 
              font-size: 0.7rem; 
              padding: 0.3rem 0.45rem;
              flex-shrink: 0;
            }
            .more-btn { 
              font-size: 0.65rem; 
              padding: 0.3rem 0.45rem; 
            }
            
            .search-container input { 
              width: 100px;
              font-size: 0.7rem;
            }
            
            .movie-grid { 
              grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); 
              gap: 0.625rem; 
            }
            .movie-info { padding: 0.4rem; }
            .movie-title { font-size: 0.75rem; }
            .movie-year, .movie-meta { font-size: 0.625rem; }
          }
        </style>
      </head>
      <body>
        <!-- Loading Screen -->
        <div id="loading-screen" style="display:none; position:fixed; inset:0; background:var(--bg-dark); z-index:9999; display:flex; align-items:center; justify-content:center;">
          <div style="text-align:center;"><i class="fas fa-film" style="font-size:3rem; color:var(--primary-color); animation:spin 1s linear infinite;"></i><p style="margin-top:1rem; color:var(--text-secondary);">Cargando biblioteca...</p></div>
        </div>

        <!-- Navbar -->
        <nav class="navbar">
          <div class="container">
            <div class="nav-content">
              <a class="navbar-brand" href="/library?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}">
                <div class="logo-container">
                  <span class="logo-title">Infinity Scrap</span>
                </div>
              </a>
              <div class="navbar-links" id="navbar-links">
                <span id="library-links"></span>
                <div class="dropdown-container" id="more-libraries" style="display: none;">
                  <button class="more-btn" id="more-btn">
                    Más <i class="fas fa-chevron-down"></i>
                  </button>
                  <div class="dropdown-menu" id="dropdown-menu">
                    <!-- Bibliotecas adicionales -->
                  </div>
                </div>
              </div>
              <div class="navbar-controls">
                <div class="search-container">
                  <input type="text" id="search-input" placeholder="Buscar ${libraryTitle.toLowerCase()}...">
                  <i class="fas fa-search"></i>
                </div>
              </div>
            </div>
          </div>
        </nav>
        
        <!-- Mobile Search Bar -->
        <div class="mobile-search-bar">
          <div class="mobile-search-wrapper">
            <input type="text" id="search-input-mobile" placeholder="0 películas" readonly>
            <button class="mobile-search-btn" id="mobile-search-btn" aria-label="Buscar">
              <i class="fas fa-search"></i>
            </button>
            <button class="mobile-filter-btn" id="mobile-filter-btn" aria-label="Abrir filtros">
              <i class="fas fa-filter"></i>
            </button>
          </div>
        </div>

        <!-- Mobile Filters Sidebar -->
        <div class="filters-overlay" id="filters-overlay"></div>
        <aside class="filters-sidebar" id="filters-sidebar">
          <div class="filters-sidebar-header">
            <h3><i class="fas fa-filter"></i> Filtros</h3>
            <button class="filters-sidebar-close" id="filters-sidebar-close" aria-label="Cerrar filtros">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="filters-sidebar-content">
            <div class="filter-section">
              <div class="filter-section-title">BÚSQUEDA</div>
              <div class="sidebar-search-box">
                <input type="text" id="search-input-sidebar" placeholder="Buscar películas...">
                <i class="fas fa-search"></i>
              </div>
            </div>
            <div class="filter-section">
              <div class="filter-section-title">GÉNERO</div>
              <select id="genre-filter-mobile" class="filter-select-mobile">
                <option value="">Todos los géneros</option>
              </select>
            </div>
            <div class="filter-section">
              <div class="filter-section-title">AÑO</div>
              <select id="year-filter-mobile" class="filter-select-mobile">
                <option value="">Todos los años</option>
              </select>
            </div>
            <div class="filter-section">
              <div class="filter-section-title">PAÍS</div>
              <select id="country-filter-mobile" class="filter-select-mobile">
                <option value="">Todos los países</option>
              </select>
            </div>
            <div class="filter-section">
              <div class="filter-section-title">VALORACIÓN</div>
              <select id="rating-filter-mobile" class="filter-select-mobile">
                <option value="">Todas las valoraciones</option>
                <option value="9">⭐ 9.0+</option>
                <option value="8">⭐ 8.0+</option>
                <option value="7">⭐ 7.0+</option>
                <option value="6">⭐ 6.0+</option>
              </select>
            </div>
            <div class="filter-section">
              <div class="filter-section-title">ORDENAR POR</div>
              <select id="sort-filter-mobile" class="filter-select-mobile">
                <option value="added-desc">Recientes</option>
                <option value="added-asc">Antiguos</option>
                <option value="title">Título A-Z</option>
                <option value="title-desc">Título Z-A</option>
                <option value="year-desc">Año ↓</option>
                <option value="year-asc">Año ↑</option>
                <option value="rating-desc">Valoración ↓</option>
                <option value="rating-asc">Valoración ↑</option>
              </select>
            </div>
            <div class="sidebar-view-buttons">
              <button class="sidebar-view-btn active" id="grid-view-btn-mobile" onclick="toggleView('grid', true)">
                <i class="fas fa-th"></i>
                <span>Grid</span>
              </button>
              <button class="sidebar-view-btn" id="list-view-btn-mobile" onclick="toggleView('list', true)">
                <i class="fas fa-list"></i>
                <span>Lista</span>
              </button>
            </div>
            <button id="clear-filters-mobile" class="sidebar-clear-btn">
              <i class="fas fa-broom"></i> Limpiar filtros
            </button>
          </div>
        </aside>
        
        <!-- Library Controls -->
        <div class="library-controls">
          <div class="container">
            <div class="controls-row">
              <!-- Left: Title & Count -->
              <div class="library-info">
                <h1 class="library-title"><i class="fas fa-${libraryType === 'movie' ? 'film' : 'tv'}"></i> ${libraryTitle}</h1>
                <span id="footer-count" class="library-count">(${items.length} ${libraryType === 'movie' ? 'películas' : 'series'})</span>
              </div>
              
              <!-- Center: Filters -->
              <div class="filters-group">
                <select id="genre-filter" class="filter-select">
                  <option value="">Géneros</option>
                  ${uniqueGenres.map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
                <select id="year-filter" class="filter-select">
                  <option value="">Años</option>
                  ${uniqueYears.map(y => `<option value="${y}">${y}</option>`).join('')}
                </select>
                <select id="country-filter" class="filter-select">
                  <option value="">Países</option>
                  ${uniqueCountries.map(co => `<option value="${co}">${co}</option>`).join('')}
                </select>
                <select id="sort-filter" class="filter-select">
                  <option value="added-desc">Recientes</option>
                  <option value="added-asc">Antiguos</option>
                  <option value="title">Título A-Z</option>
                  <option value="title-desc">Título Z-A</option>
                  <option value="year-desc">Año ↓</option>
                  <option value="year-asc">Año ↑</option>
                  <option value="rating-desc">Puntuación ↓</option>
                  <option value="rating-asc">Puntuación ↑</option>
                </select>
                <button id="clear-filters" class="btn-clear-filters">
                  <i class="fas fa-broom"></i> Limpiar
                </button>
              </div>
              
              <!-- Right: View Controls -->
              <div class="view-controls">
                <div class="grid-size-control" id="grid-size-control">
                  <input type="range" id="grid-size-slider" min="120" max="250" value="180" step="10">
                  <i class="fas fa-expand-alt"></i>
                </div>
                <div class="view-buttons">
                  <button class="view-btn active" id="grid-view-btn" title="Vista grid">
                    <i class="fas fa-th"></i>
                  </button>
                  <button class="view-btn" id="list-view-btn" title="Vista lista">
                    <i class="fas fa-list"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Main Content -->
        <main class="main-content">
          <div class="container">
            <div id="movies-grid" class="movie-grid">
              <!-- Tarjetas se generarán dinámicamente desde JSON -->
            </div>
          </div>
        </main>
        
        <script>
          // Imagen fallback para posters que fallan
          const FALLBACK_POSTER = 'https://raw.githubusercontent.com/sergioat93/plex-redirect/main/no-poster-disponible.jpg';
          
          // ENFOQUE HÍBRIDO: Primer lote de 50 items completos + índice ligero de todos
          const itemsData = ${JSON.stringify(items.slice(0, 50))};
          const itemsIndex = ${JSON.stringify(items.map(item => ({
            id: item.ratingKey,
            title: item.title,
            year: item.year || '',
            genres: item.genres || [],
            collections: item.collections || [],
            rating: item.rating || 0,
            thumb: item.thumb || '',
            ratingKey: item.ratingKey,
            tmdbId: item.tmdbId || '',
            countries: item.countries || [],
            summary: item.summary || '',
            addedAt: item.addedAt || 0
          })))};
          const accessToken = '${accessToken}';
          const baseURI = '${baseURI}';
          const libraryType = '${libraryType}';
          const libraryKey = '${libraryKey}';
          const libraryTitle = '${libraryTitle}';
          
          // INMEDIATAMENTE: Actualizar ratings desde localStorage ANTES de cualquier render
          (function updateRatingsFromCache() {
            const type = libraryType === 'movie' ? 'movie' : 'tv';
            
            // Actualizar itemsData
            itemsData.forEach(item => {
              if ((item.rating === 0 || !item.rating) && item.tmdbId) {
                const cacheKey = \`tmdb_rating_\${type}_\${item.tmdbId}\`;
                const cached = localStorage.getItem(cacheKey);
                if (cached && parseFloat(cached) > 0) {
                  item.rating = parseFloat(cached);
                }
              }
            });
            
            // Actualizar itemsIndex
            itemsIndex.forEach(item => {
              if ((item.rating === 0 || !item.rating) && item.tmdbId) {
                const cacheKey = \`tmdb_rating_\${type}_\${item.tmdbId}\`;
                const cached = localStorage.getItem(cacheKey);
                if (cached && parseFloat(cached) > 0) {
                  item.rating = parseFloat(cached);
                }
              }
            });
          })();
          
          // Función para generar HTML de una tarjeta
          function createCardHTML(item) {
            const itemTitle = item.title;
            const itemYear = item.year || '';
            let itemRating = parseFloat(item.rating) || 0;
            const posterPath = item.thumb || '';
            const tmdbId = item.tmdbId || '';
            const genres = item.genres ? item.genres.join(',') : '';
            const genresDisplay = item.genres ? item.genres.slice(0, 3).join(', ') : '';
            const collections = item.collections ? item.collections.join(',') : '';
            const countries = item.countries ? item.countries.join(',') : '';
            const summary = item.summary || '';
            const addedAt = item.addedAt || 0;
            
            // **CRÍTICO**: Consultar localStorage ANTES de renderizar
            // Si el rating es 0 y hay un rating en cache, usarlo
            if (itemRating === 0 && tmdbId) {
              const type = libraryType === 'movie' ? 'movie' : 'tv';
              const cacheKey = \`tmdb_rating_\${type}_\${tmdbId}\`;
              const cached = localStorage.getItem(cacheKey);
              if (cached && parseFloat(cached) > 0) {
                itemRating = parseFloat(cached);
              }
            }
            
            const detailUrl = libraryType === 'movie' 
              ? \`/movie-redirect?accessToken=\${encodeURIComponent(accessToken)}&baseURI=\${encodeURIComponent(baseURI)}&ratingKey=\${item.ratingKey}&title=\${encodeURIComponent(item.title)}&posterUrl=\${encodeURIComponent(item.thumb)}&tmdbId=\${item.tmdbId}&libraryKey=\${libraryKey}&libraryTitle=\${encodeURIComponent(libraryTitle)}\`
              : \`/series-redirect?accessToken=\${encodeURIComponent(accessToken)}&baseURI=\${encodeURIComponent(baseURI)}&ratingKey=\${item.ratingKey}&title=\${encodeURIComponent(item.title)}&posterUrl=\${encodeURIComponent(item.thumb)}&tmdbId=\${item.tmdbId}&libraryKey=\${libraryKey}&libraryTitle=\${encodeURIComponent(libraryTitle)}\`;
            
            return \`
              <div class="movie-card" 
                   data-title="\${itemTitle.toLowerCase()}" 
                   data-year="\${itemYear}"
                   data-rating="\${itemRating}"
                   data-genres="\${genres.toLowerCase()}"
                   data-collections="\${collections.toLowerCase()}"
                   data-countries="\${countries.toLowerCase()}"
                   data-summary="\${summary.replace(/"/g, '&quot;')}"
                   data-tmdb-id="\${tmdbId}"
                   data-rating-key="\${item.ratingKey}"
                   data-added-at="\${addedAt}"
                   onclick="window.location.href='\${detailUrl}'">
                <div class="movie-poster">
                  \${posterPath ? \`<img loading="lazy" src="\${posterPath}" alt="\${itemTitle}" onerror="this.onerror=null; this.src='\${FALLBACK_POSTER}';" />\` : \`<img loading="lazy" src="\${FALLBACK_POSTER}" alt="Sin poster" />\`}
                  <div class="movie-overlay">
                    <div class="movie-overlay-content">
                      <div class="overlay-title">\${itemTitle}</div>
                      <div class="overlay-meta">
                        \${itemYear ? \`<span class="overlay-year">\${itemYear}</span>\` : ''}
                        <span class="overlay-rating" data-tmdb-rating style="opacity: \${itemRating > 0 ? '1' : '0.5'}">
                          <i class="fas fa-star"></i>
                          <span class="rating-value">\${itemRating > 0 ? itemRating.toFixed(1) : '--'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="movie-info">
                  <div class="movie-title" title="\${itemTitle}">\${itemTitle}\${itemYear ? \` <span class="movie-year list-only">(\${itemYear})</span>\` : ''}</div>
                  \${itemYear ? \`<div class="movie-year grid-only">\${itemYear}</div>\` : ''}
                  <div class="movie-meta">
                    <span class="movie-rating" data-tmdb-rating style="opacity: \${itemRating > 0 ? '1' : '0.5'}">
                      <i class="fas fa-star"></i>
                      <span class="rating-value">\${itemRating > 0 ? itemRating.toFixed(1) : '--'}</span>
                    </span>
                    \${genresDisplay ? \`<span class="movie-genres">\${genresDisplay}</span>\` : ''}
                  </div>
                  <div class="movie-overview">\${summary}</div>
                </div>
              </div>
            \`;
          }
          
          // Variables para lazy loading
          let allCards = [];
          let currentDisplayedIndex = 0;
          const BATCH_SIZE = 50;
          let isLoading = false;
          let observer = null;
          
          // Renderizar solo un lote de tarjetas
          function renderBatch(startIndex, endIndex) {
            const grid = document.getElementById('movies-grid');
            const batch = itemsData.slice(startIndex, endIndex);
            const htmlArray = batch.map(item => createCardHTML(item));
            grid.insertAdjacentHTML('beforeend', htmlArray.join(''));
            
            // PRIMERO: Actualizar ratings desde localStorage inmediatamente
            syncRatingsFromLocalStorage();
            
            // DESPUÉS: Inicializar observer para los que no estén en localStorage
            setTimeout(() => initRatingLazyLoader(), 100);
            
            return Array.from(grid.querySelectorAll('.movie-card'));
          }
          
          // Generar primer lote de tarjetas desde los datos cargados
          window.filteredItemIds = itemsIndex.map(item => item.ratingKey);
          loadAndRenderBatch(0, Math.min(BATCH_SIZE, itemsIndex.length));
          
          // Cargar más tarjetas al hacer scroll (sin uso ahora, usamos loadAndRenderBatch)
          function loadMoreCards() {
            // Esta función ya no se usa, se maneja con loadAndRenderBatch
          }
          
          // Observer para detectar scroll al final (sin uso ahora)
          function setupScrollObserver() {
            // Esta función ya no se usa, se maneja con setupFilteredScrollObserver
          }
          
          // No iniciar observer al principio, se maneja con applyFilters
          
          // Load all libraries and show them in navbar with overflow dropdown
          fetch('${baseURI}/library/sections?X-Plex-Token=${accessToken}')
            .then(r => r.text())
            .then(xmlText => {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
              const directories = xmlDoc.querySelectorAll('Directory');
              const libraryLinksContainer = document.getElementById('library-links');
              const moreLibrariesContainer = document.getElementById('more-libraries');
              const dropdownMenu = document.getElementById('dropdown-menu');
              const moreBtn = document.getElementById('more-btn');
              
              const allLibraries = [];
              
              directories.forEach(dir => {
                const key = dir.getAttribute('key');
                const title = dir.getAttribute('title');
                const type = dir.getAttribute('type');
                
                if (key && title && (type === 'movie' || type === 'show')) {
                  allLibraries.push({ key, title, type, isActive: title === '${libraryTitle}' });
                }
              });
              
              // Renderizar bibliotecas con detección automática de overflow
              function renderLibraries() {
                libraryLinksContainer.innerHTML = '';
                dropdownMenu.innerHTML = '';
                moreLibrariesContainer.style.setProperty('display', 'none', 'important');
                
                // Renderizar TODAS las bibliotecas
                allLibraries.forEach((lib) => {
                  const browseUrl = '/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=' + lib.key + '&libraryTitle=' + encodeURIComponent(lib.title) + '&libraryType=' + lib.type;
                  const a = document.createElement('a');
                  a.href = browseUrl;
                  a.innerHTML = '<i class="fas fa-' + (lib.type === 'movie' ? 'film' : 'tv') + '"></i> ' + lib.title;
                  if (lib.isActive) a.classList.add('active');
                  libraryLinksContainer.appendChild(a);
                });
                
                // Detectar overflow y reorganizar
                requestAnimationFrame(() => {
                  const navbarLinks = libraryLinksContainer.parentElement;
                  if (!navbarLinks) return;
                  
                  // Verificar si hay overflow
                  const isOverflowing = navbarLinks.scrollWidth > navbarLinks.clientWidth;
                  
                  if (!isOverflowing) {
                    // No hay overflow, mostrar todas
                    moreLibrariesContainer.style.setProperty('display', 'none', 'important');
                    console.log('✅ Todas las bibliotecas caben (' + allLibraries.length + ')');
                    return;
                  }
                  
                  // Hay overflow - necesitamos el botón "Más"
                  // Mostrar el botón primero
                  moreLibrariesContainer.style.setProperty('display', 'inline-flex');
                  
                  // Algoritmo optimizado: intentar poner la activa + las más cortas
                  requestAnimationFrame(() => {
                    const links = Array.from(libraryLinksContainer.children);
                    
                    // Crear array con índice y ancho de cada biblioteca
                    const libsWithWidth = allLibraries.map((lib, index) => ({
                      index: index,
                      lib: lib,
                      width: links[index] ? links[index].offsetWidth : 0,
                      isActive: lib.isActive
                    }));
                    
                    // Separar la activa y ordenar las demás por ancho (más cortas primero)
                    const activeLib = libsWithWidth.find(l => l.isActive);
                    const otherLibs = libsWithWidth.filter(l => !l.isActive).sort((a, b) => a.width - b.width);
                    
                    // Intentar agregar bibliotecas hasta que haya overflow
                    let visibleIndices = [];
                    if (activeLib) visibleIndices.push(activeLib.index);
                    
                    // Limpiar y re-renderizar solo con las seleccionadas
                    const tryRender = (indices) => {
                      libraryLinksContainer.innerHTML = '';
                      
                      // Ordenar índices para mantener el orden original
                      indices.sort((a, b) => a - b);
                      
                      indices.forEach(i => {
                        const lib = allLibraries[i];
                        const browseUrl = '/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=' + lib.key + '&libraryTitle=' + encodeURIComponent(lib.title) + '&libraryType=' + lib.type;
                        const a = document.createElement('a');
                        a.href = browseUrl;
                        a.innerHTML = '<i class="fas fa-' + (lib.type === 'movie' ? 'film' : 'tv') + '"></i> ' + lib.title;
                        if (lib.isActive) a.classList.add('active');
                        libraryLinksContainer.appendChild(a);
                      });
                    };
                    
                    // Intentar agregar las más cortas una por una
                    for (let i = 0; i < otherLibs.length; i++) {
                      const testIndices = [...visibleIndices, otherLibs[i].index];
                      tryRender(testIndices);
                      
                      // Esperar un frame y verificar overflow
                      if (navbarLinks.scrollWidth <= navbarLinks.clientWidth) {
                        visibleIndices.push(otherLibs[i].index);
                      } else {
                        // Ya no cabe, volver al estado anterior
                        tryRender(visibleIndices);
                        break;
                      }
                    }
                    
                    // Poner las no visibles en el dropdown
                    dropdownMenu.innerHTML = '';
                    allLibraries.forEach((lib, index) => {
                      if (!visibleIndices.includes(index)) {
                        const browseUrl = '/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=' + lib.key + '&libraryTitle=' + encodeURIComponent(lib.title) + '&libraryType=' + lib.type;
                        const a = document.createElement('a');
                        a.href = browseUrl;
                        a.innerHTML = '<i class="fas fa-' + (lib.type === 'movie' ? 'film' : 'tv') + '"></i> ' + lib.title;
                        if (lib.isActive) a.classList.add('active');
                        dropdownMenu.appendChild(a);
                      }
                    });
                    
                    console.log('📚 Bibliotecas:', visibleIndices.length, 'visibles de', allLibraries.length);
                  });
                });
              }
              
              renderLibraries();
              
              // Flag para evitar múltiples listeners
              let dropdownListenerAdded = false;
              
              // Event delegation en el documento para el botón Más
              if (!dropdownListenerAdded) {
                document.addEventListener('click', function(e) {
                  const moreBtn = e.target.closest('#more-btn');
                  
                  // Si se hizo click en el botón Más
                  if (moreBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const dropdown = document.getElementById('dropdown-menu');
                    if (dropdown) {
                      const wasActive = moreBtn.classList.contains('active');
                      moreBtn.classList.toggle('active');
                      dropdown.classList.toggle('show');
                      console.log('🔽 Dropdown:', wasActive ? 'cerrando' : 'abriendo');
                    }
                    return;
                  }
                  
                  // Si se hizo click en una biblioteca del dropdown
                  const dropdownLink = e.target.closest('#dropdown-menu a');
                  if (dropdownLink) {
                    e.preventDefault();
                    
                    // Extraer libraryKey de la URL
                    const url = new URL(dropdownLink.href);
                    const clickedKey = url.searchParams.get('libraryKey');
                    
                    if (clickedKey) {
                      // Encontrar la biblioteca clickeada
                      const clickedLib = allLibraries.find(lib => lib.key === clickedKey);
                      if (clickedLib) {
                        // Remover de su posición actual
                        const index = allLibraries.indexOf(clickedLib);
                        allLibraries.splice(index, 1);
                        // Agregar al principio
                        allLibraries.unshift(clickedLib);
                        
                        console.log('📌 Biblioteca movida al principio:', clickedLib.title);
                        
                        // Cerrar dropdown
                        const btn = document.getElementById('more-btn');
                        const menu = document.getElementById('dropdown-menu');
                        if (btn) btn.classList.remove('active');
                        if (menu) menu.classList.remove('show');
                        
                        // Navegar a la biblioteca después de re-renderizar
                        window.location.href = dropdownLink.href;
                      }
                    }
                    return;
                  }
                  
                  // Si se hizo click fuera del contenedor del dropdown
                  const moreContainer = document.getElementById('more-libraries');
                  if (moreContainer && !moreContainer.contains(e.target)) {
                    const btn = document.getElementById('more-btn');
                    const menu = document.getElementById('dropdown-menu');
                    if (btn && btn.classList.contains('active')) {
                      btn.classList.remove('active');
                      if (menu) menu.classList.remove('show');
                      console.log('🔽 Dropdown cerrado (click fuera)');
                    }
                  }
                });
                dropdownListenerAdded = true;
                console.log('✅ Dropdown listener configurado');
              }
              
              // Reajustar al cambiar tamaño de ventana
              let resizeTimeout;
              window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                  renderLibraries();
                }, 200);
              });
            })
            .catch(e => console.error('Error loading libraries:', e));
          
          // **MOBILE SEARCH & FILTERS**
          const mobileSearchInput = document.getElementById('search-input-mobile');
          const mobileSearchBtn = document.getElementById('mobile-search-btn');
          const mobileFilterBtn = document.getElementById('mobile-filter-btn');
          const filtersSidebar = document.getElementById('filters-sidebar');
          const filtersOverlay = document.getElementById('filters-overlay');
          const filtersSidebarClose = document.getElementById('filters-sidebar-close');
          const searchInputSidebar = document.getElementById('search-input-sidebar');
          
          // Mobile search input - click para abrir sidebar de búsqueda
          if (mobileSearchInput) {
            mobileSearchInput.addEventListener('click', () => {
              openFiltersSidebar();
              setTimeout(() => {
                if (searchInputSidebar) {
                  searchInputSidebar.focus();
                  searchInputSidebar.removeAttribute('readonly');
                }
              }, 300);
            });
          }
          
          // Mobile search button - ejecuta búsqueda o limpia
          if (mobileSearchBtn) {
            mobileSearchBtn.addEventListener('click', () => {
              const desktopSearch = document.getElementById('search-input');
              if (desktopSearch && desktopSearch.value.trim()) {
                // Si hay búsqueda activa, limpiarla
                desktopSearch.value = '';
                desktopSearch.dispatchEvent(new Event('input'));
                if (searchInputSidebar) searchInputSidebar.value = '';
              }
            });
          }
          
          // Mobile filter button - abre sidebar
          if (mobileFilterBtn) {
            mobileFilterBtn.addEventListener('click', openFiltersSidebar);
          }
          
          // Cerrar sidebar
          if (filtersSidebarClose) {
            filtersSidebarClose.addEventListener('click', closeFiltersSidebar);
          }
          
          if (filtersOverlay) {
            filtersOverlay.addEventListener('click', closeFiltersSidebar);
          }
          
          function openFiltersSidebar() {
            if (filtersSidebar) filtersSidebar.classList.add('active');
            if (filtersOverlay) filtersOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
          }
          
          function closeFiltersSidebar() {
            if (filtersSidebar) filtersSidebar.classList.remove('active');
            if (filtersOverlay) filtersOverlay.classList.remove('active');
            document.body.style.overflow = '';
          }
          
          // Sincronizar búsqueda sidebar con desktop
          if (searchInputSidebar) {
            searchInputSidebar.addEventListener('input', (e) => {
              const desktopSearch = document.getElementById('search-input');
              if (desktopSearch) {
                desktopSearch.value = e.target.value;
                desktopSearch.dispatchEvent(new Event('input'));
              }
            });
          }
          
          // Sincronizar filtros móviles con desktop
          const genreFilterMobile = document.getElementById('genre-filter-mobile');
          const yearFilterMobile = document.getElementById('year-filter-mobile');
          const countryFilterMobile = document.getElementById('country-filter-mobile');
          const ratingFilterMobile = document.getElementById('rating-filter-mobile');
          
          if (genreFilterMobile) {
            genreFilterMobile.addEventListener('change', (e) => {
              const desktopGenre = document.getElementById('genre-filter');
              if (desktopGenre) {
                desktopGenre.value = e.target.value;
                desktopGenre.dispatchEvent(new Event('change'));
              }
            });
          }
          
          if (yearFilterMobile) {
            yearFilterMobile.addEventListener('change', (e) => {
              const desktopYear = document.getElementById('year-filter');
              if (desktopYear) {
                desktopYear.value = e.target.value;
                desktopYear.dispatchEvent(new Event('change'));
              }
            });
          }
          
          if (countryFilterMobile) {
            countryFilterMobile.addEventListener('change', (e) => {
              const desktopCountry = document.getElementById('country-filter');
              if (desktopCountry) {
                desktopCountry.value = e.target.value;
                desktopCountry.dispatchEvent(new Event('change'));
              }
            });
          }
          
          if (ratingFilterMobile) {
            ratingFilterMobile.addEventListener('change', (e) => {
              const desktopRating = document.getElementById('rating-filter');
              if (desktopRating) {
                desktopRating.value = e.target.value;
                desktopRating.dispatchEvent(new Event('change'));
              }
            });
          }
          
          const sortFilterMobile = document.getElementById('sort-filter-mobile');
          if (sortFilterMobile) {
            sortFilterMobile.addEventListener('change', (e) => {
              const desktopSort = document.getElementById('sort-filter');
              if (desktopSort) {
                desktopSort.value = e.target.value;
                desktopSort.dispatchEvent(new Event('change'));
              }
            });
          }
          
          // Limpiar filtros desde móvil
          const clearFiltersMobile = document.getElementById('clear-filters-mobile');
          if (clearFiltersMobile) {
            clearFiltersMobile.addEventListener('click', () => {
              // Limpiar búsqueda
              const desktopSearch = document.getElementById('search-input');
              if (desktopSearch) {
                desktopSearch.value = '';
                desktopSearch.dispatchEvent(new Event('input'));
              }
              if (searchInputSidebar) searchInputSidebar.value = '';
              
              // Limpiar filtros
              const desktopGenre = document.getElementById('genre-filter');
              const desktopYear = document.getElementById('year-filter');
              const desktopCountry = document.getElementById('country-filter');
              const desktopRating = document.getElementById('rating-filter');
              const desktopSort = document.getElementById('sort-filter');
              
              if (desktopGenre) {
                desktopGenre.value = '';
                desktopGenre.dispatchEvent(new Event('change'));
              }
              if (desktopYear) {
                desktopYear.value = '';
                desktopYear.dispatchEvent(new Event('change'));
              }
              if (desktopCountry) {
                desktopCountry.value = '';
                desktopCountry.dispatchEvent(new Event('change'));
              }
              if (desktopRating) {
                desktopRating.value = '';
                desktopRating.dispatchEvent(new Event('change'));
              }
              if (desktopSort) {
                desktopSort.value = 'added-desc';
                desktopSort.dispatchEvent(new Event('change'));
              }
              
              // Actualizar filtros móviles
              if (genreFilterMobile) genreFilterMobile.value = '';
              if (yearFilterMobile) yearFilterMobile.value = '';
              if (countryFilterMobile) countryFilterMobile.value = '';
              if (ratingFilterMobile) ratingFilterMobile.value = '';
              if (sortFilterMobile) sortFilterMobile.value = 'added-desc';
              
              // Cerrar sidebar después de limpiar
              setTimeout(() => {
                closeFiltersSidebar();
              }, 300);
            });
          }
          
          // **TMDB RATINGS API**: Configuración y funciones
          const TMDB_API_KEY = '${TMDB_API_KEY}'; // Inyectado desde el servidor
          const TMDB_API_BASE = 'https://api.themoviedb.org/3';
          
          // Función para decodificar HTML entities
          function decodeHtmlEntities(text) {
            if (!text) return text;
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            return textarea.value;
          }
          
          // Sincronizar ratings desde localStorage inmediatamente después de renderizar
          function syncRatingsFromLocalStorage() {
            const type = '${libraryType}' === 'movie' ? 'movie' : 'tv';
            
            document.querySelectorAll('.movie-card').forEach(card => {
              const currentRating = card.dataset.rating;
              const tmdbId = card.dataset.tmdbId;
              
              // Solo sincronizar si no tiene rating y tiene tmdbId
              if (currentRating === '0' && tmdbId) {
                const cacheKey = \`tmdb_rating_\${type}_\${tmdbId}\`;
                const cached = localStorage.getItem(cacheKey);
                
                // Si está en localStorage y NO es 0, actualizar inmediatamente
                if (cached && cached !== '0' && cached !== '0.0' && parseFloat(cached) > 0) {
                  updateCardRating(card, cached);
                }
              }
            });
          }
          
          // Función para obtener rating de TMDB
          async function fetchTMDBRating(tmdbId, type = 'movie') {
            if (!tmdbId) return null;
            
            try {
              const url = \`\${TMDB_API_BASE}/\${type}/\${tmdbId}?api_key=\${TMDB_API_KEY}\`;
              const response = await fetch(url);
              if (!response.ok) return null;
              
              const data = await response.json();
              
              // Si vote_average existe (incluso si es 0), devolverlo
              if (data.vote_average !== undefined && data.vote_average !== null) {
                return parseFloat(data.vote_average).toFixed(1);
              }
              
              return null;
            } catch (error) {
              console.error('Error fetching TMDB rating:', error);
              return null;
            }
          }
          
          // Función para actualizar rating en una tarjeta
          function updateCardRating(card, rating) {
            if (!card || !rating) return;
            
            // Actualizar en .movie-info (grid/list view)
            const ratingElement = card.querySelector('.movie-rating');
            if (ratingElement) {
              ratingElement.textContent = \`⭐ \${rating}\`;
              ratingElement.style.opacity = '1';
            }
            
            // Actualizar en overlay (hover)
            const overlayRating = card.querySelector('.overlay-rating .rating-value');
            if (overlayRating) {
              overlayRating.textContent = rating;
            }
            
            // Actualizar data-rating attribute
            card.dataset.rating = rating;
          }
          
          // Lazy loading de ratings con IntersectionObserver
          let loadedRatings = new Set();
          let ratingObserver = null;
          
          function initRatingLazyLoader() {
            // Crear observer solo una vez
            if (!ratingObserver) {
              console.log('[RATING INIT] Creando IntersectionObserver');
              ratingObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                  if (entry.isIntersecting) {
                    const card = entry.target;
                    const tmdbId = card.dataset.tmdbId || '';
                    const ratingKey = card.dataset.ratingKey;
                    const currentRating = card.dataset.rating;
                    
                    console.log('[RATING OBSERVER] Card visible:', card.dataset.title, 'rating:', currentRating, 'tmdbId:', tmdbId);
                    
                    // Procesar si no tiene rating
                    if (currentRating === '0' && !loadedRatings.has(ratingKey)) {
                      loadedRatings.add(ratingKey);
                      console.log('[RATING OBSERVER] Llamando a loadRatingForCard para:', card.dataset.title);
                      loadRatingForCard(card, tmdbId, ratingKey);
                    }
                    
                    // Dejar de observar esta card
                    ratingObserver.unobserve(card);
                  }
                });
              }, {
                rootMargin: '200px'
              });
            }
            
            // Observar todas las cards con rating 0
            const cardsToObserve = document.querySelectorAll('.movie-card[data-rating="0"]');
            console.log('[RATING INIT] Cards a observar:', cardsToObserve.length);
            
            cardsToObserve.forEach(card => {
              ratingObserver.observe(card);
            });
          }
          
          // Cargar rating para una card específica
          async function loadRatingForCard(card, tmdbId, ratingKey) {
            const type = '${libraryType}' === 'movie' ? 'movie' : 'tv';
            
            // Si NO tiene tmdbId, buscar en TMDB por título + año
            if (!tmdbId || tmdbId.trim() === '') {
              const title = decodeHtmlEntities(card.dataset.title); // Decodificar HTML entities
              const year = card.dataset.year;
              
              console.log('[RATING] Sin tmdbId, buscando en TMDB:', title, year);
              
              if (title && year) {
                try {
                  const searchUrl = \`\${TMDB_API_BASE}/search/\${type}?api_key=\${TMDB_API_KEY}&language=es-ES&query=\${encodeURIComponent(title)}&year=\${year}\`;
                  const searchResponse = await fetch(searchUrl);
                  const searchData = await searchResponse.json();
                  
                  if (searchData.results && searchData.results.length > 0) {
                    tmdbId = searchData.results[0].id.toString();
                    console.log('[RATING] TMDB ID encontrado:', tmdbId, 'para', title);
                    
                    // Guardar el tmdbId en la card para futuras búsquedas
                    card.dataset.tmdbId = tmdbId;
                  } else {
                    console.log('[RATING] No se encontró en TMDB:', title, year);
                    return;
                  }
                } catch (error) {
                  console.error('[RATING] Error buscando tmdbId:', error);
                  return;
                }
              } else {
                console.log('[RATING] Faltan datos para buscar (título o año)');
                return;
              }
            }
            
            // Verificar localStorage primero
            const cacheKey = \`tmdb_rating_\${type}_\${tmdbId}\`;
            const cached = localStorage.getItem(cacheKey);
            
            console.log('[RATING OBSERVER] Procesando card:', { tmdbId, cacheKey, cached, type });
            
            if (cached) {
              updateCardRating(card, cached);
              return;
            }
            
            // Consultar TMDB API
            const rating = await fetchTMDBRating(tmdbId, type);
            
            if (rating !== null) {
              // Guardar en localStorage (incluso si es 0)
              localStorage.setItem(cacheKey, rating);
              
              // Solo actualizar card si el rating es mayor que 0
              if (rating !== '0.0' && rating !== '0' && parseFloat(rating) > 0) {
                updateCardRating(card, rating);
                console.log(\`[RATING] Rating cargado: \${tmdbId} = \${rating}\`);
              } else {
                console.log(\`[RATING] Película sin votos en TMDB: \${tmdbId} (guardado en cache como 0)\`);
              }
            }
          }
          
          // Inicializar lazy loader cuando el DOM esté listo
          window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
              initRatingLazyLoader();
              // Procesar cards visibles inmediatamente
              processVisibleCards();
            }, 500);
          });
          
          // Función para procesar cards visibles inmediatamente (sin esperar al observer)
          function processVisibleCards() {
            const cardsToProcess = document.querySelectorAll('.movie-card[data-rating="0"]');
            console.log('[RATING] Procesando cards visibles inmediatamente:', cardsToProcess.length);
            
            cardsToProcess.forEach(card => {
              const rect = card.getBoundingClientRect();
              const isVisible = (
                rect.top >= 0 &&
                rect.left >= 0 &&
                rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                rect.right <= (window.innerWidth || document.documentElement.clientWidth)
              );
              
              if (isVisible) {
                const ratingKey = card.dataset.ratingKey;
                const tmdbId = card.dataset.tmdbId || '';
                if (!loadedRatings.has(ratingKey)) {
                  console.log('[RATING] Card visible en carga inicial:', card.dataset.title);
                  loadRatingForCard(card, tmdbId, ratingKey);
                }
              }
            });
          }
          
          // **CONTADOR DINÁMICO**: Actualizar contador en mobile search bar
          function updateMobileSearchCounter(count) {
            const mobileSearchInput = document.getElementById('search-input-mobile');
            if (mobileSearchInput) {
              const label = '${libraryType}' === 'movie' ? 'películas' : 'series';
              mobileSearchInput.placeholder = count + ' ' + label;
            }
          }

          // **FILTROS DINÁMICOS**: Actualizar opciones de filtros basados en items filtrados
          function updateDynamicFilters(filteredItems) {
            // Obtener valores actuales seleccionados
            const currentGenre = document.getElementById('genre-filter').value;
            const currentYear = document.getElementById('year-filter').value;
            const currentCountry = document.getElementById('country-filter').value;
            
            // Extraer valores disponibles de items filtrados
            const availableGenres = new Set();
            const availableYears = new Set();
            const availableCountries = new Set();
            
            filteredItems.forEach(item => {
              // Géneros
              if (Array.isArray(item.genres)) {
                item.genres.forEach(g => availableGenres.add(g));
              }
              
              // Años
              if (item.year) availableYears.add(item.year.toString());
              
              // Países
              if (item.countries) {
                const countriesArray = Array.isArray(item.countries) 
                  ? item.countries 
                  : item.countries.split(',').map(c => c.trim());
                countriesArray.forEach(country => {
                  const trimmed = typeof country === 'string' ? country.trim() : country;
                  if (trimmed) availableCountries.add(trimmed);
                });
              }
            });
            
            // Actualizar filtro de género
            const genreFilter = document.getElementById('genre-filter');
            const genreOptions = '<option value="">Géneros</option>' + 
              Array.from(availableGenres).sort().map(genre => 
                \`<option value="\${genre}" \${genre === currentGenre ? 'selected' : ''}>\${genre}</option>\`
              ).join('');
            genreFilter.innerHTML = genreOptions;
            
            // Sincronizar con móvil
            const genreFilterMobile = document.getElementById('genre-filter-mobile');
            if (genreFilterMobile) {
              genreFilterMobile.innerHTML = genreOptions;
            }
            
            // Actualizar filtro de año
            const yearFilter = document.getElementById('year-filter');
            const yearOptions = '<option value="">Años</option>' + 
              Array.from(availableYears).sort((a, b) => b - a).map(year => 
                \`<option value="\${year}" \${year === currentYear ? 'selected' : ''}>\${year}</option>\`
              ).join('');
            yearFilter.innerHTML = yearOptions;
            
            // Sincronizar con móvil
            const yearFilterMobile = document.getElementById('year-filter-mobile');
            if (yearFilterMobile) {
              yearFilterMobile.innerHTML = yearOptions;
            }
            
            // Actualizar filtro de país
            const countryFilter = document.getElementById('country-filter');
            const countryOptions = '<option value="">Países</option>' + 
              Array.from(availableCountries).sort().map(country => 
                \`<option value="\${country}" \${country === currentCountry ? 'selected' : ''}>\${country}</option>\`
              ).join('');
            countryFilter.innerHTML = countryOptions;
            
            // Sincronizar con móvil
            const countryFilterMobile = document.getElementById('country-filter-mobile');
            if (countryFilterMobile) {
              countryFilterMobile.innerHTML = countryOptions;
            }
          }
          
          // Filtrar y ordenar sobre el índice ligero
          function applyFilters() {
            const searchValue = document.getElementById('search-input').value;
            const genreValue = document.getElementById('genre-filter').value;
            const yearValue = document.getElementById('year-filter').value;
            const countryValue = document.getElementById('country-filter').value;
            const sortValue = document.getElementById('sort-filter').value;
            
            // Función helper para normalizar texto (compartida)
            const normalizeText = (text) => {
              if (!text) return '';
              // Función para decodificar entidades HTML
              const decodeHTML = (str) => {
                if (!str) return '';
                const txt = document.createElement('textarea');
                txt.innerHTML = str;
                return txt.value;
              };
              
              // Primero decodificar entidades HTML, luego normalizar
              const decoded = decodeHTML(text);
              return decoded
                .toString()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            };
            
            // Filtrar sobre el índice completo (22k items, búsqueda instantánea)
            let filteredData = itemsIndex.filter(item => {
              // Búsqueda: solo sobre título y año (datos del índice ligero)
              if (searchValue && searchValue.trim() !== '') {
                const searchNormalized = normalizeText(searchValue);
                const titleNormalized = normalizeText(item.title);
                const yearNormalized = normalizeText(item.year);
                
                const titleMatch = titleNormalized.includes(searchNormalized);
                const yearMatch = yearNormalized.includes(searchNormalized);
                
                if (!titleMatch && !yearMatch) return false;
              }
              
              // Filtro de género - comparación normalizada
              if (genreValue) {
                const itemGenres = Array.isArray(item.genres) ? item.genres : [];
                const genreNormalized = normalizeText(genreValue);
                
                // Normalizar cada género del item y comparar
                const hasGenre = itemGenres.some(g => normalizeText(g) === genreNormalized);
                if (!hasGenre) return false;
              }
              
              // Filtro de año - comparación directa
              if (yearValue) {
                if (item.year !== yearValue && item.year !== parseInt(yearValue)) return false;
              }
              
              // Filtro de país - comparación normalizada
              if (countryValue) {
                const countries = Array.isArray(item.countries) 
                  ? item.countries 
                  : (item.countries ? item.countries.split(',').map(c => c.trim()) : []);
                
                const countryNormalized = normalizeText(countryValue);
                const hasCountry = countries.some(c => normalizeText(c) === countryNormalized);
                if (!hasCountry) return false;
              }
              
              return true;
            });
            
            // **FILTROS DINÁMICOS**: Actualizar opciones disponibles basadas en los items filtrados
            updateDynamicFilters(filteredData);
            
            // Ordenar
            filteredData.sort((a, b) => {
              switch(sortValue) {
                case 'title':
                  return a.title.localeCompare(b.title);
                case 'title-desc':
                  return b.title.localeCompare(a.title);
                case 'year-desc':
                  return (b.year || '0') - (a.year || '0');
                case 'year-asc':
                  return (a.year || '0') - (b.year || '0');
                case 'rating-desc':
                  return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
                case 'rating-asc':
                  return (parseFloat(a.rating) || 0) - (parseFloat(b.rating) || 0);
                case 'added-desc':
                  return (b.addedAt || 0) - (a.addedAt || 0);
                case 'added-asc':
                  return (a.addedAt || 0) - (b.addedAt || 0);
                default:
                  return 0;
              }
            });
            
            // Limpiar grid y regenerar con IDs filtrados
            const grid = document.getElementById('movies-grid');
            grid.innerHTML = '';
            
            // Guardar IDs filtrados para cargar datos completos bajo demanda
            window.filteredItemIds = filteredData.map(item => item.ratingKey);
            
            // Resetear lazy loading
            if (observer) observer.disconnect();
            currentDisplayedIndex = 0;
            allCards = [];
            
            // Renderizar primer lote (cargar datos completos si no los tenemos)
            if (filteredData.length > 0) {
              loadAndRenderBatch(0, Math.min(BATCH_SIZE, filteredData.length));
            }
            
            // Actualizar contador
            document.getElementById('footer-count').textContent = '(' + filteredData.length + ' ${libraryType === 'movie' ? 'películas' : 'series'}' + ')';
            
            // Actualizar contador móvil
            updateMobileSearchCounter(filteredData.length);
          }
          
          // Cargar datos completos del servidor y renderizar
          async function loadAndRenderBatch(startIndex, endIndex) {
            const idsToLoad = window.filteredItemIds.slice(startIndex, endIndex);
            
            // Buscar en itemsData los que ya tenemos
            const itemsToRender = [];
            const missingIds = [];
            
            idsToLoad.forEach(id => {
              const existing = itemsData.find(item => item.ratingKey === id);
              if (existing) {
                itemsToRender.push(existing);
              } else {
                missingIds.push(id);
              }
            });
            
            // Si faltan datos, cargar del servidor (TODO: implementar endpoint)
            // Por ahora, crear datos mínimos desde el índice
            if (missingIds.length > 0) {
              missingIds.forEach(id => {
                const indexItem = itemsIndex.find(item => item.ratingKey === id);
                if (indexItem) {
                  itemsToRender.push({
                    ...indexItem,
                    summary: '',
                    overview: '',
                    collections: [],
                    genres: indexItem.genres || [],
                    countries: indexItem.countries || []
                  });
                }
              });
            }
            
            // Renderizar
            const grid = document.getElementById('movies-grid');
            const htmlArray = itemsToRender.map(item => createCardHTML(item));
            grid.insertAdjacentHTML('beforeend', htmlArray.join(''));
            allCards = Array.from(grid.querySelectorAll('.movie-card'));
            currentDisplayedIndex = endIndex;
            
            // Configurar observer si hay más
            if (endIndex < window.filteredItemIds.length) {
              setupFilteredScrollObserver();
            }
          }
          
          // Observer para scroll con datos filtrados
          function setupFilteredScrollObserver() {
            if (observer) observer.disconnect();
            
            const lastCard = allCards[allCards.length - 1];
            if (!lastCard) return;
            
            observer = new IntersectionObserver((entries) => {
              entries.forEach(entry => {
                if (entry.isIntersecting && !isLoading) {
                  isLoading = true;
                  const totalFiltered = window.filteredItemIds.length;
                  const endIndex = Math.min(currentDisplayedIndex + BATCH_SIZE, totalFiltered);
                  
                  loadAndRenderBatch(currentDisplayedIndex, endIndex).then(() => {
                    isLoading = false;
                  });
                }
              });
            }, {
              rootMargin: '200px'
            });
            
            observer.observe(lastCard);
          }
          
          // Update filter options based on currently visible cards
          function updateFilterOptions(cards) {
            const currentGenre = document.getElementById('genre-filter').value;
            const currentYear = document.getElementById('year-filter').value;
            const currentCollection = document.getElementById('collection-filter').value;
            const currentCountry = document.getElementById('country-filter').value;
            
            // Extract available values from visible cards
            const availableGenres = new Set();
            const availableYears = new Set();
            const availableCollections = new Set();
            const availableCountries = new Set();
            
            cards.forEach(card => {
              if (card.dataset.genres) {
                card.dataset.genres.split(',').forEach(g => {
                  if (g.trim()) availableGenres.add(g.trim());
                });
              }
              if (card.dataset.year) availableYears.add(card.dataset.year);
              if (card.dataset.collections) {
                card.dataset.collections.split(',').forEach(c => {
                  if (c.trim()) availableCollections.add(c.trim());
                });
              }
              if (card.dataset.countries) {
                card.dataset.countries.split(',').forEach(co => {
                  if (co.trim()) availableCountries.add(co.trim());
                });
              }
            });
            
            // Update genre filter
            const genreFilter = document.getElementById('genre-filter');
            const genreOptions = genreFilter.querySelectorAll('option:not(:first-child)');
            genreOptions.forEach(opt => {
              opt.disabled = !availableGenres.has(opt.value.toLowerCase());
            });
            
            // Update year filter
            const yearFilter = document.getElementById('year-filter');
            const yearOptions = yearFilter.querySelectorAll('option:not(:first-child)');
            yearOptions.forEach(opt => {
              opt.disabled = !availableYears.has(opt.value);
            });
            
            // Update collection filter (only for movies)
            if ('${libraryType}' === 'movie') {
              const collectionFilter = document.getElementById('collection-filter');
              const collectionOptions = collectionFilter.querySelectorAll('option:not(:first-child)');
              collectionOptions.forEach(opt => {
                opt.disabled = !availableCollections.has(opt.value.toLowerCase());
              });
            }
            
            // Update country filter
            const countryFilter = document.getElementById('country-filter');
            const countryOptions = countryFilter.querySelectorAll('option:not(:first-child)');
            countryOptions.forEach(opt => {
              opt.disabled = !availableCountries.has(opt.value.toLowerCase());
            });
          }
          
          // Event listeners for filters
          document.getElementById('search-input').addEventListener('input', applyFilters);
          document.getElementById('genre-filter').addEventListener('change', applyFilters);
          document.getElementById('year-filter').addEventListener('change', applyFilters);
          document.getElementById('country-filter').addEventListener('change', applyFilters);
          document.getElementById('sort-filter').addEventListener('change', (e) => {
            // Sincronizar con móvil
            const sortFilterMobile = document.getElementById('sort-filter-mobile');
            if (sortFilterMobile) sortFilterMobile.value = e.target.value;
            applyFilters();
          });
          
          document.getElementById('clear-filters').addEventListener('click', () => {
            document.getElementById('search-input').value = '';
            document.getElementById('genre-filter').value = '';
            document.getElementById('year-filter').value = '';
            document.getElementById('country-filter').value = '';
            document.getElementById('sort-filter').value = 'added-desc';
            
            // Sincronizar con móvil
            const genreFilterMobile = document.getElementById('genre-filter-mobile');
            const yearFilterMobile = document.getElementById('year-filter-mobile');
            const countryFilterMobile = document.getElementById('country-filter-mobile');
            const sortFilterMobile = document.getElementById('sort-filter-mobile');
            if (genreFilterMobile) genreFilterMobile.value = '';
            if (yearFilterMobile) yearFilterMobile.value = '';
            if (countryFilterMobile) countryFilterMobile.value = '';
            if (sortFilterMobile) sortFilterMobile.value = 'added-desc';
            
            applyFilters();
          });
          
          // Grid size slider
          const gridSizeSlider = document.getElementById('grid-size-slider');
          const moviesGrid = document.getElementById('movies-grid');
          
          gridSizeSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            moviesGrid.style.setProperty('--card-size', size + 'px');
          });
          
          // View mode toggle
          const gridViewBtn = document.getElementById('grid-view-btn');
          const listViewBtn = document.getElementById('list-view-btn');
          const gridViewBtnMobile = document.getElementById('grid-view-btn-mobile');
          const listViewBtnMobile = document.getElementById('list-view-btn-mobile');
          const gridSizeControl = document.getElementById('grid-size-control');
          
          function toggleView(mode, fromMobile = false) {
            if (mode === 'grid') {
              moviesGrid.classList.remove('list-view');
              gridViewBtn.classList.add('active');
              listViewBtn.classList.remove('active');
              if (gridViewBtnMobile) gridViewBtnMobile.classList.add('active');
              if (listViewBtnMobile) listViewBtnMobile.classList.remove('active');
              if (gridSizeControl) gridSizeControl.classList.remove('hidden');
            } else {
              moviesGrid.classList.add('list-view');
              listViewBtn.classList.add('active');
              gridViewBtn.classList.remove('active');
              if (listViewBtnMobile) listViewBtnMobile.classList.add('active');
              if (gridViewBtnMobile) gridViewBtnMobile.classList.remove('active');
              if (gridSizeControl) gridSizeControl.classList.add('hidden');
            }
          }
          
          gridViewBtn.addEventListener('click', () => toggleView('grid'));
          listViewBtn.addEventListener('click', () => toggleView('list'));
          
          // Los datos ya están en Plex (rating, géneros, sinopsis)
          // No necesitamos fetch de TMDB
          // console.log('✅ Usando datos de Plex: ratings, géneros, colecciones y sinopsis ya disponibles');
          
          // Initialize with "Recientes" filter and apply
          document.getElementById('sort-filter').value = 'added-desc';
          applyFilters();
          
          // Inicializar contador móvil
          updateMobileSearchCounter(itemsIndex.length);
          
          // Hide loading screen
          document.getElementById('loading-screen').style.display = 'none';
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error fetching library content:', error);
    res.status(500).send('Error al obtener el contenido de la biblioteca');
  }
});

// Ruta para mostrar las bibliotecas disponibles
app.get('/library', async (req, res) => {
  const { accessToken, baseURI, action, password, adminPassword } = req.query;
  
  // ========================================
  // ACCIONES DE ADMIN (sin accessToken/baseURI)
  // ========================================
  
  // Verificar password de admin
  if (action === 'verify-admin') {
    if (password === ADMIN_PASSWORD) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  }
  
  // Obtener lista de servidores (solo admin)
  if (action === 'get-servers') {
    if (adminPassword !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    try {
      if (!serversCollection) {
        await connectMongoDB();
      }
      
      const servers = await serversCollection
        .find({})
        .sort({ lastAccess: -1 })
        .toArray();
      
      // Transformar para el selector: un servidor = una entrada (no duplicados)
      // Usar el token más reciente de cada servidor
      const formattedServers = servers.map(server => {
        // Ordenar tokens por lastAccess (más reciente primero)
        const sortedTokens = server.tokens?.sort((a, b) => 
          new Date(b.lastAccess) - new Date(a.lastAccess)
        ) || [];
        
        // Usar el token más reciente como principal
        const primaryToken = sortedTokens[0];
        
        return {
          machineIdentifier: server.machineIdentifier,
          serverName: server.serverName,
          baseURI: server.baseURI,
          accessToken: primaryToken?.accessToken || '',
          lastAccess: server.lastAccess,
          libraryCount: server.libraryCount,
          libraryNames: server.libraryNames,
          tokenCount: sortedTokens.length // Para debug
        };
      });
      
      return res.json({ servers: formattedServers });
    } catch (error) {
      console.error('Error obteniendo servidores:', error);
      return res.status(500).json({ error: 'Error al obtener servidores' });
    }
  }
  
  // ========================================
  // MODO NORMAL: Mostrar bibliotecas
  // ========================================
  
  if (!accessToken || !baseURI) {
    return res.status(400).send('Faltan parámetros requeridos: accessToken, baseURI');
  }
  
  try {
    // Obtener todas las bibliotecas de Plex
    const librariesUrl = `${baseURI}/library/sections?X-Plex-Token=${accessToken}`;
    const xmlData = await httpsGetXML(librariesUrl);
    
    // Extraer bibliotecas del XML
    const libraries = [];
    const directoryMatches = xmlData.matchAll(/<Directory[^>]*>/g);
    
    for (const match of directoryMatches) {
      const dirTag = match[0];
      const keyMatch = dirTag.match(/key="([^"]*)"/);
      const titleMatch = dirTag.match(/title="([^"]*)"/);
      const typeMatch = dirTag.match(/type="([^"]*)"/);
      
      if (keyMatch && titleMatch && typeMatch) {
        libraries.push({
          key: keyMatch[1],
          title: titleMatch[1],
          type: typeMatch[1]
        });
      }
    }
    
    // Auto-registrar servidor en MongoDB (con soporte multi-token)
    if (serversCollection || await connectMongoDB()) {
      try {
        // Obtener machineIdentifier y nombre del servidor desde el XML
        let machineIdentifier = null;
        let serverName = 'Servidor Plex';
        
        try {
          const serverUrl = `${baseURI}/?X-Plex-Token=${accessToken}`;
          const serverXml = await httpsGetXML(serverUrl);
          const nameMatch = serverXml.match(/friendlyName="([^"]*)"/);
          const idMatch = serverXml.match(/machineIdentifier="([^"]*)"/);
          
          if (nameMatch) serverName = nameMatch[1];
          if (idMatch) machineIdentifier = idMatch[1];
        } catch (e) {
          console.error('Error obteniendo info del servidor:', e);
        }
        
        // Si no obtuvimos machineIdentifier, generar uno basado en baseURI
        if (!machineIdentifier) {
          machineIdentifier = crypto.createHash('md5').update(baseURI).digest('hex');
        }
        
        // Buscar si ya existe un servidor con este machineIdentifier
        const existingServer = await serversCollection.findOne({ machineIdentifier });
        
        if (existingServer) {
          // Servidor existe: agregar nuevo token a la lista de tokens
          const tokenHash = crypto.createHash('md5').update(accessToken).digest('hex');
          const tokenExists = existingServer.tokens?.some(t => t.tokenHash === tokenHash);
          
          if (!tokenExists) {
            // Nuevo token: agregarlo a la lista
            await serversCollection.updateOne(
              { machineIdentifier },
              {
                $push: {
                  tokens: {
                    tokenHash,
                    accessToken,
                    addedAt: new Date(),
                    lastAccess: new Date(),
                    libraryCount: libraries.length,
                    libraryNames: libraries.map(l => l.title)
                  }
                },
                $set: { lastAccess: new Date() }
              }
            );
            console.log(`🔑 Nuevo token agregado al servidor: ${serverName}`);
          } else {
            // Token ya existe: actualizar su información
            await serversCollection.updateOne(
              { machineIdentifier, 'tokens.tokenHash': tokenHash },
              {
                $set: {
                  'tokens.$.lastAccess': new Date(),
                  'tokens.$.libraryCount': libraries.length,
                  'tokens.$.libraryNames': libraries.map(l => l.title),
                  lastAccess: new Date()
                }
              }
            );
            console.log(`♻️ Token actualizado para: ${serverName}`);
          }
          
          // Fusionar bibliotecas únicas (para el selector)
          const allLibraries = new Set(existingServer.libraryNames || []);
          libraries.forEach(l => allLibraries.add(l.title));
          
          await serversCollection.updateOne(
            { machineIdentifier },
            { $set: { libraryNames: Array.from(allLibraries) } }
          );
        } else {
          // Servidor nuevo: crear entrada con primer token
          const tokenHash = crypto.createHash('md5').update(accessToken).digest('hex');
          
          await serversCollection.insertOne({
            machineIdentifier,
            serverName,
            baseURI,
            createdAt: new Date(),
            lastAccess: new Date(),
            libraryCount: libraries.length,
            libraryNames: libraries.map(l => l.title),
            tokens: [{
              tokenHash,
              accessToken,
              addedAt: new Date(),
              lastAccess: new Date(),
              libraryCount: libraries.length,
              libraryNames: libraries.map(l => l.title)
            }]
          });
          
          console.log(`✨ Nuevo servidor registrado: ${serverName}`);
        }
      } catch (error) {
        console.error('Error registrando servidor:', error);
      }
    }
    
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bibliotecas - Infinity Scrap</title>
        <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            color: #f3f4f6;
            min-height: 100vh;
            padding: 2rem;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
          }
          .header {
            text-align: center;
            margin-bottom: 4rem;
          }
          .logo {
            display: inline-flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
          }
          .logo-icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(229, 160, 13, 0.4);
          }
          .logo-text {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
          }
          .subtitle {
            font-size: 1.125rem;
            color: #9ca3af;
          }
          .libraries-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin-top: 3rem;
          }
          .library-card {
            background: rgba(31, 41, 55, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 2.5rem;
            border: 1px solid rgba(229, 160, 13, 0.2);
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
          }
          .library-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 40px rgba(229, 160, 13, 0.3);
            border-color: rgba(229, 160, 13, 0.5);
          }
          .library-icon {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
          }
          .library-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
          }
          .library-type {
            font-size: 0.875rem;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          /* Admin Icon - Esquina superior derecha */
          .admin-icon {
            position: fixed;
            top: 1.5rem;
            right: 1.5rem;
            width: 48px;
            height: 48px;
            background: rgba(31, 41, 55, 0.9);
            border: 2px solid rgba(229, 160, 13, 0.3);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            cursor: pointer;
            transition: all 0.3s ease;
            z-index: 100;
            backdrop-filter: blur(10px);
          }
          .admin-icon:hover {
            border-color: rgba(229, 160, 13, 0.8);
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(229, 160, 13, 0.4);
          }
          .admin-icon.active {
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            border-color: #f5b81d;
          }
          
          /* Dropdown Servidores - Arriba izquierda (solo admin) */
          .server-selector {
            position: fixed;
            top: 1.5rem;
            left: 1.5rem;
            z-index: 100;
            display: none;
            max-width: 350px;
          }
          .server-selector.active {
            display: block;
          }
          .server-selector-label {
            color: #9ca3af;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
            font-weight: 600;
            display: block;
          }
          .server-selector select {
            width: 100%;
            padding: 1rem 3rem 1rem 3.5rem;
            background: rgba(31, 41, 55, 0.95);
            background-image: 
              url("data:text/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23e5a00d' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M12 6v6l4 2'/%3E%3C/svg%3E"),
              url("data:text/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23e5a00d' d='M8 11L3 6h10z'/%3E%3C/svg%3E");
            background-repeat: no-repeat, no-repeat;
            background-position: 1rem center, right 1rem center;
            border: 2px solid rgba(229, 160, 13, 0.3);
            border-radius: 16px;
            color: #f3f4f6;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            backdrop-filter: blur(20px);
            appearance: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          }
          .server-selector select:hover {
            border-color: rgba(229, 160, 13, 0.6);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(229, 160, 13, 0.3);
          }
          .server-selector select:focus {
            outline: none;
            border-color: #e5a00d;
            box-shadow: 0 0 0 4px rgba(229, 160, 13, 0.1);
          }
          .server-selector select option {
            background: #1f2937;
            color: #f3f4f6;
            padding: 1rem;
            font-weight: 500;
          }
          
          /* Botón Actualizar - Abajo derecha */
          .btn-refresh {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            padding: 1rem 1.5rem;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            color: #000;
            font-size: 1rem;
            font-weight: 600;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(229, 160, 13, 0.3);
            z-index: 50;
          }
          .btn-refresh:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(229, 160, 13, 0.5);
          }
          .btn-refresh:active {
            transform: translateY(0);
          }
          .btn-refresh svg {
            width: 20px;
            height: 20px;
          }
          .btn-refresh.loading svg {
            animation: rotate 1s linear infinite;
          }
          @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          
          /* Modal Login Admin */
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 200;
            backdrop-filter: blur(5px);
          }
          .modal-overlay.active {
            display: flex;
          }
          .modal {
            background: rgba(31, 41, 55, 0.95);
            border: 2px solid rgba(229, 160, 13, 0.3);
            border-radius: 24px;
            padding: 2.5rem;
            max-width: 400px;
            width: 90%;
            backdrop-filter: blur(20px);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          }
          .modal-title {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 1rem;
            text-align: center;
          }
          .modal-subtitle {
            color: #9ca3af;
            font-size: 0.95rem;
            margin-bottom: 2rem;
            text-align: center;
          }
          .modal-input {
            width: 100%;
            padding: 1rem;
            background: rgba(17, 24, 39, 0.8);
            border: 2px solid rgba(229, 160, 13, 0.2);
            border-radius: 12px;
            color: #f3f4f6;
            font-size: 1rem;
            margin-bottom: 1.5rem;
            transition: all 0.3s ease;
          }
          .modal-input:focus {
            outline: none;
            border-color: #e5a00d;
          }
          .modal-buttons {
            display: flex;
            gap: 1rem;
          }
          .modal-btn {
            flex: 1;
            padding: 1rem;
            border: none;
            border-radius: 12px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          .modal-btn-primary {
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            color: #000;
          }
          .modal-btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(229, 160, 13, 0.4);
          }
          .modal-btn-secondary {
            background: rgba(31, 41, 55, 0.8);
            color: #f3f4f6;
            border: 2px solid rgba(229, 160, 13, 0.2);
          }
          .modal-btn-secondary:hover {
            border-color: rgba(229, 160, 13, 0.5);
          }
          .error-message {
            color: #ef4444;
            font-size: 0.875rem;
            margin-top: -1rem;
            margin-bottom: 1rem;
            text-align: center;
          }
          
          /* Responsive */
          @media (max-width: 768px) {
            body {
              padding: 1rem;
            }
            .logo-text {
              font-size: 1.75rem;
            }
            .logo-icon {
              width: 48px;
              height: 48px;
              font-size: 1.5rem;
            }
            h1 {
              font-size: 1.5rem;
            }
            .subtitle {
              font-size: 1rem;
            }
            .admin-icon {
              top: 1rem;
              right: 1rem;
              width: 40px;
              height: 40px;
              font-size: 1.25rem;
            }
            .server-selector {
              position: relative;
              top: auto;
              left: auto;
              max-width: 100%;
              margin: 2rem auto 2rem auto;
              padding: 0;
            }
            .server-selector select {
              padding: 0.875rem 2.5rem 0.875rem 3rem;
              font-size: 0.875rem;
              background-position: 0.75rem center, right 0.75rem center;
              background-size: 18px, 14px;
            }
            .btn-refresh {
              bottom: 1rem;
              right: 1rem;
              padding: 0.875rem 1.25rem;
              font-size: 0.95rem;
            }
            .btn-refresh svg {
              width: 18px;
              height: 18px;
            }
            .libraries-grid {
              grid-template-columns: 1fr;
              gap: 1.5rem;
              margin-top: 2rem;
            }
            .modal {
              padding: 2rem;
            }
          }
          @media (max-width: 480px) {
            .btn-refresh span {
              display: none;
            }
            .btn-refresh {
              padding: 1rem;
              border-radius: 50%;
              width: 48px;
              height: 48px;
              justify-content: center;
            }
          }
        </style>
      </head>
      <body>
        <!-- Icono Admin (esquina superior derecha) -->
        <div class="admin-icon" id="adminIcon" onclick="toggleAdminLogin()">
          🔐
        </div>
        
        <!-- Modal Login Admin -->
        <div class="modal-overlay" id="modalOverlay">
          <div class="modal">
            <h2 class="modal-title">🔐 Acceso Administrador</h2>
            <p class="modal-subtitle">Introduce la contraseña para acceder al modo admin</p>
            <input type="password" class="modal-input" id="adminPassword" placeholder="Contraseña" />
            <div class="error-message" id="errorMessage" style="display: none;">❌ Contraseña incorrecta</div>
            <div class="modal-buttons">
              <button class="modal-btn modal-btn-secondary" onclick="closeAdminLogin()">Cancelar</button>
              <button class="modal-btn modal-btn-primary" onclick="verifyAdmin()">Acceder</button>
            </div>
          </div>
        </div>
        
        <!-- Botón Actualizar (abajo derecha) -->
        <button class="btn-refresh" id="refreshBtn" onclick="refreshLibraries()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          <span>Actualizar</span>
        </button>
        
        <div class="container">
          <div class="header">
            <div class="logo">
              <div class="logo-icon">☁</div>
              <span class="logo-text">Infinity Scrap</span>
            </div>
            <h1>Selecciona una Biblioteca</h1>
            <p class="subtitle">Explora tu contenido multimedia</p>
            
            <!-- Dropdown Servidores (solo visible en modo admin) -->
            <div class="server-selector" id="serverSelector">
              <label class="server-selector-label">🌐 SERVIDOR ACTIVO</label>
              <select id="serverDropdown" onchange="switchServer()">
                <option value="">Cargando servidores...</option>
              </select>
            </div>
          </div>
          
          <div class="libraries-grid">
            ${libraries.map(lib => `
              <div class="library-card" onclick="window.location.href='/browse?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(baseURI)}&libraryKey=${lib.key}&libraryTitle=${encodeURIComponent(lib.title)}&libraryType=${lib.type}'">
                <div class="library-icon">${lib.type === 'movie' ? '🎬' : lib.type === 'show' ? '📺' : '🎭'}</div>
                <div class="library-title">${lib.title}</div>
                <div class="library-type">${lib.type === 'movie' ? 'Películas' : lib.type === 'show' ? 'Series' : 'Contenido'}</div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <script>
          // Variables globales
          const currentToken = '${accessToken}';
          const currentURI = '${baseURI}';
          let isAdminMode = sessionStorage.getItem('adminMode') === 'true';
          let adminPasswordStored = sessionStorage.getItem('adminPassword');
          
          // Inicializar al cargar
          window.addEventListener('DOMContentLoaded', () => {
            if (isAdminMode && adminPasswordStored) {
              activateAdminMode();
            }
            
            // Enter para enviar password
            document.getElementById('adminPassword').addEventListener('keypress', (e) => {
              if (e.key === 'Enter') verifyAdmin();
            });
          });
          
          // Toggle modal login
          function toggleAdminLogin() {
            if (isAdminMode) {
              // Ya está en modo admin - desactivar
              deactivateAdminMode();
            } else {
              // Mostrar modal login
              document.getElementById('modalOverlay').classList.add('active');
              document.getElementById('adminPassword').focus();
            }
          }
          
          function closeAdminLogin() {
            document.getElementById('modalOverlay').classList.remove('active');
            document.getElementById('adminPassword').value = '';
            document.getElementById('errorMessage').style.display = 'none';
          }
          
          // Verificar password admin
          async function verifyAdmin() {
            const password = document.getElementById('adminPassword').value;
            
            if (!password) {
              document.getElementById('errorMessage').textContent = '⚠️ Introduce una contraseña';
              document.getElementById('errorMessage').style.display = 'block';
              return;
            }
            
            try {
              const response = await fetch('/library?action=verify-admin&password=' + encodeURIComponent(password));
              const data = await response.json();
              
              if (data.success) {
                adminPasswordStored = password;
                sessionStorage.setItem('adminMode', 'true');
                sessionStorage.setItem('adminPassword', password);
                closeAdminLogin();
                activateAdminMode();
              } else {
                document.getElementById('errorMessage').textContent = '❌ Contraseña incorrecta';
                document.getElementById('errorMessage').style.display = 'block';
              }
            } catch (error) {
              console.error('Error verificando admin:', error);
              document.getElementById('errorMessage').textContent = '⚠️ Error de conexión';
              document.getElementById('errorMessage').style.display = 'block';
            }
          }
          
          // Activar modo admin
          async function activateAdminMode() {
            isAdminMode = true;
            document.getElementById('adminIcon').classList.add('active');
            document.getElementById('serverSelector').classList.add('active');
            
            // Cargar lista de servidores
            try {
              const response = await fetch('/library?action=get-servers&adminPassword=' + encodeURIComponent(adminPasswordStored));
              const data = await response.json();
              
              if (data.servers) {
                const dropdown = document.getElementById('serverDropdown');
                dropdown.innerHTML = '';
                
                // Marcar servidor actual
                const currentServerId = generateServerId(currentToken, currentURI);
                
                data.servers.forEach(server => {
                  const serverId = generateServerId(server.accessToken, server.baseURI);
                  const option = document.createElement('option');
                  option.value = JSON.stringify({ accessToken: server.accessToken, baseURI: server.baseURI });
                  
                  // Formatear fecha de último acceso
                  const lastAccess = new Date(server.lastAccess);
                  const timeAgo = getTimeAgo(lastAccess);
                  
                  // Texto del option
                  const isCurrent = serverId === currentServerId;
                  option.textContent = \`\${isCurrent ? '● ' : ''}\${server.serverName} · \${server.libraryCount} libs · \${timeAgo}\`;
                  
                  if (isCurrent) {
                    option.selected = true;
                    option.style.fontWeight = '700';
                  }
                  
                  dropdown.appendChild(option);
                });
                
                console.log('✅ Modo admin activado -', data.servers.length, 'servidores disponibles');
              }
            } catch (error) {
              console.error('Error cargando servidores:', error);
              document.getElementById('serverDropdown').innerHTML = '<option>Error cargando servidores</option>';
            }
          }
          
          // Generar ID del servidor (para comparar)
          function generateServerId(token, uri) {
            return btoa(uri + '-' + token).substring(0, 16);
          }
          
          // Calcular tiempo transcurrido
          function getTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);
            
            if (seconds < 60) return 'ahora';
            if (seconds < 3600) return \`hace \${Math.floor(seconds / 60)}m\`;
            if (seconds < 86400) return \`hace \${Math.floor(seconds / 3600)}h\`;
            if (seconds < 2592000) return \`hace \${Math.floor(seconds / 86400)}d\`;
            return \`hace \${Math.floor(seconds / 2592000)}m\`;
          }
          
          // Desactivar modo admin
          function deactivateAdminMode() {
            isAdminMode = false;
            sessionStorage.removeItem('adminMode');
            sessionStorage.removeItem('adminPassword');
            document.getElementById('adminIcon').classList.remove('active');
            document.getElementById('serverSelector').classList.remove('active');
            console.log('🔒 Modo admin desactivado');
          }
          
          // Cambiar de servidor
          function switchServer() {
            const dropdown = document.getElementById('serverDropdown');
            const selectedValue = dropdown.value;
            
            if (!selectedValue) return;
            
            try {
              const serverData = JSON.parse(selectedValue);
              const newUrl = \`/library?accessToken=\${encodeURIComponent(serverData.accessToken)}&baseURI=\${encodeURIComponent(serverData.baseURI)}\`;
              window.location.href = newUrl;
            } catch (error) {
              console.error('Error cambiando servidor:', error);
            }
          }
          
          // Refrescar bibliotecas
          function refreshLibraries() {
            const btn = document.getElementById('refreshBtn');
            btn.classList.add('loading');
            btn.disabled = true;
            
            const url = \`/library?accessToken=\${encodeURIComponent(currentToken)}&baseURI=\${encodeURIComponent(currentURI)}&_refresh=\${Date.now()}\`;
            
            setTimeout(() => {
              window.location.href = url;
            }, 500);
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error fetching libraries:', error);
    res.status(500).send('Error al obtener las bibliotecas');
  }
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  console.log(`✅ Servidor Infinity Scrap escuchando en http://${host}:${port}`);
});
