import { Track, ArtistProfile, Playlist, PlaylistFolder } from "./types";

export const EYE_ARTWORK = "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=600&auto=format&fit=crop&q=80";

export const TEMPER_CITY_ARTIST: ArtistProfile = {
  id: "temper-city",
  name: "Temper City",
  thumb: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80",
  banner: "https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=1200&auto=format&fit=crop&q=80",
  verified: true,
  monthlyListeners: "135M monthly listeners",
  subscribers: "4.8M subscribers",
  bio: "Temper City is an Israeli alternative rock band made up of vocalist Eytan Peled and producers Chen Kordova and Aviv Barenbolt. Blending atmospheric post-punk aesthetics with modern distortion and cinematic electronics, their debut breakout single 'Self Aware' captivated millions worldwide.",
  topTracks: [
    {
      id: "temper-1",
      title: "Self Aware",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Self Aware - Single",
      durationMs: 180000,
      coverUrl: EYE_ARTWORK,
      streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3",
      source: "spotify",
      isLiked: true,
      verified: true,
    },
    {
      id: "temper-2",
      title: "Fade to Blue",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Metropolis Horizon",
      durationMs: 215000,
      coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3",
      source: "spotify",
      isLiked: true,
      verified: true,
    },
    {
      id: "temper-3",
      title: "Neon Skyline",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Metropolis Horizon",
      durationMs: 198000,
      coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3",
      source: "youtube",
      isLiked: false,
      verified: true,
    },
    {
      id: "temper-4",
      title: "Echoes in the Dark",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Lost Frequencies",
      durationMs: 224000,
      coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://cdn.freesound.org/previews/517/517677_11861866-lq.mp3",
      source: "youtube",
      isLiked: false,
      verified: true,
    },
    {
      id: "temper-5",
      title: "Gravity Well",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Lost Frequencies",
      durationMs: 202000,
      coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3",
      source: "youtube",
      isLiked: true,
      verified: true,
    },
    {
      id: "temper-6",
      title: "Midnight Horizon",
      artist: "Temper City",
      artistId: "temper-city",
      album: "Metropolis Horizon",
      durationMs: 240000,
      coverUrl: EYE_ARTWORK,
      streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3",
      source: "youtube",
      isLiked: false,
      verified: true,
    },
  ],
  albums: [
    { id: "alb-1", title: "Metropolis Horizon", year: "2024", thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80", type: "Album" },
    { id: "alb-2", title: "Self Aware - Single", year: "2023", thumb: EYE_ARTWORK, type: "Single" },
    { id: "alb-3", title: "Lost Frequencies EP", year: "2022", thumb: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80", type: "EP" },
  ],
};

export const CALVIN_HARRIS_ARTIST: ArtistProfile = {
  id: "calvin-harris",
  name: "Calvin Harris",
  thumb: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
  banner: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&auto=format&fit=crop&q=80",
  verified: true,
  monthlyListeners: "82.4M monthly listeners",
  bio: "Adam Richard Wiles, known professionally as Calvin Harris, is a Scottish DJ, record producer, singer, and songwriter. With countless multi-platinum chart-toppers, he has defined global electronic dance music.",
  topTracks: [
    { id: "ch-1", title: "Summer", artist: "Calvin Harris", artistId: "calvin-harris", album: "Motion", durationMs: 222000, coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3", isLiked: true, verified: true },
    { id: "ch-2", title: "Feel So Close", artist: "Calvin Harris", artistId: "calvin-harris", album: "18 Months", durationMs: 206000, coverUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3", isLiked: true, verified: true },
    { id: "ch-3", title: "One Kiss", artist: "Calvin Harris & Dua Lipa", artistId: "calvin-harris", album: "One Kiss", durationMs: 214000, coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3", isLiked: true, verified: true },
    { id: "ch-4", title: "This Is What You Came For", artist: "Calvin Harris & Rihanna", artistId: "calvin-harris", album: "This Is What You Came For", durationMs: 239000, coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/517/517677_11861866-lq.mp3", isLiked: false, verified: true },
  ],
  albums: [
    { id: "ch-alb-1", title: "18 Months", year: "2012", thumb: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80", type: "Album" },
    { id: "ch-alb-2", title: "Motion", year: "2014", thumb: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80", type: "Album" },
  ],
};

export const ARCTIC_MONKEYS_ARTIST: ArtistProfile = {
  id: "arctic-monkeys",
  name: "Arctic Monkeys",
  thumb: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80",
  banner: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=1200&auto=format&fit=crop&q=80",
  verified: true,
  monthlyListeners: "54.1M monthly listeners",
  bio: "Arctic Monkeys are an English rock band formed in Sheffield in 2002. Fronted by Alex Turner, their distinctive sound spans post-punk revival, garage rock, and lounge pop.",
  topTracks: [
    { id: "am-1", title: "Do I Wanna Know?", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "AM", durationMs: 272000, coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3", isLiked: true, verified: true },
    { id: "am-2", title: "505", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "Favourite Worst Nightmare", durationMs: 253000, coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3", isLiked: true, verified: true },
    { id: "am-3", title: "R U Mine?", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "AM", durationMs: 201000, coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3", isLiked: false, verified: true },
  ],
  albums: [
    { id: "am-alb-1", title: "AM", year: "2013", thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80", type: "Album" },
  ],
};

export const ARIANA_GRANDE_ARTIST: ArtistProfile = {
  id: "ariana-grande",
  name: "Ariana Grande",
  thumb: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80",
  banner: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&auto=format&fit=crop&q=80",
  verified: true,
  monthlyListeners: "91.8M monthly listeners",
  bio: "Ariana Grande-Butera is an American singer, songwriter, and actress known for her four-octave vocal range and signature whistle register.",
  topTracks: [
    { id: "ag-1", title: "7 rings", artist: "Ariana Grande", artistId: "ariana-grande", album: "thank u, next", durationMs: 178000, coverUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3", isLiked: true, verified: true },
    { id: "ag-2", title: "we can't be friends", artist: "Ariana Grande", artistId: "ariana-grande", album: "eternal sunshine", durationMs: 228000, coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80", streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3", isLiked: true, verified: true },
  ],
  albums: [
    { id: "ag-alb-1", title: "eternal sunshine", year: "2024", thumb: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80", type: "Album" },
  ],
};

export const ARTISTS_DATABASE: Record<string, ArtistProfile> = {
  "temper-city": TEMPER_CITY_ARTIST,
  "calvin-harris": CALVIN_HARRIS_ARTIST,
  "arctic-monkeys": ARCTIC_MONKEYS_ARTIST,
  "ariana-grande": ARIANA_GRANDE_ARTIST,
};

// The 6 "Jump back in" quick-resume tiles shown in user's screenshot
export const JUMP_BACK_IN_TRACKS: Track[] = [
  TEMPER_CITY_ARTIST.topTracks[0]!, // "Self Aware" - Temper City (Eye artwork)
  {
    id: "jbi-2",
    title: "Blinding Lights",
    artist: "The Weeknd",
    artistId: "the-weeknd",
    album: "After Hours",
    durationMs: 200000,
    coverUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-3",
    title: "I Want You Back",
    artist: "Jackson 5",
    artistId: "jackson-5",
    album: "Diana Ross Presents The Jackson 5",
    durationMs: 178000,
    coverUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-4",
    title: "Billie Jean",
    artist: "Michael Jackson",
    artistId: "michael-jackson",
    album: "Thriller",
    durationMs: 294000,
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/517/517677_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-5",
    title: "September",
    artist: "Earth, Wind & Fire",
    artistId: "earth-wind-fire",
    album: "The Best of Earth, Wind & Fire, Vol. 1",
    durationMs: 215000,
    coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-6",
    title: "Gimme! Gimme! Gimme! (A Man After Midnight)",
    artist: "ABBA",
    artistId: "abba",
    album: "Voulez-Vous",
    durationMs: 289000,
    coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
];

// The 9 Spotify-imported Liked Songs
export const LIKED_SONGS: Track[] = [
  ...JUMP_BACK_IN_TRACKS,
  {
    id: "liked-7",
    title: "Starboy",
    artist: "The Weeknd & Daft Punk",
    album: "Starboy",
    durationMs: 230000,
    coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "liked-8",
    title: "Midnight City",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    durationMs: 243000,
    coverUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/517/517677_11861866-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "liked-9",
    title: "As It Was",
    artist: "Harry Styles",
    album: "Harry's House",
    durationMs: 167000,
    coverUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3",
    source: "spotify",
    isLiked: true,
  },
];

// Playlists for you (Bollywood, etc. shown in user's screenshot)
export const PLAYLISTS_FOR_YOU: Playlist[] = [
  {
    id: "ply-1",
    title: "Bollywood Essentials",
    subtitle: "Playlist · YouTube Music",
    thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80",
    trackCount: 50,
    tracks: LIKED_SONGS,
  },
  {
    id: "ply-2",
    title: "Arijit Singh Uncut",
    subtitle: "Playlist · Best of Arijit",
    thumb: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&auto=format&fit=crop&q=80",
    trackCount: 42,
    tracks: LIKED_SONGS,
  },
  {
    id: "ply-3",
    title: "Bollywood Romance",
    subtitle: "Playlist · Love Songs",
    thumb: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=300&auto=format&fit=crop&q=80",
    trackCount: 35,
    tracks: LIKED_SONGS,
  },
  {
    id: "ply-4",
    title: "10s Bollywood",
    subtitle: "Playlist · The Best of 2010s",
    thumb: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&auto=format&fit=crop&q=80",
    trackCount: 60,
    tracks: LIKED_SONGS,
  },
  {
    id: "ply-5",
    title: "Kollywood Hits",
    subtitle: "Playlist · Tamil Bangers",
    thumb: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80",
    trackCount: 48,
    tracks: LIKED_SONGS,
  },
  {
    id: "ply-6",
    title: "Tollywood Beats",
    subtitle: "Playlist · Telugu Dance",
    thumb: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=300&auto=format&fit=crop&q=80",
    trackCount: 38,
    tracks: LIKED_SONGS,
  },
];

export const SPOTIFY_PLAYLISTS: Playlist[] = [
  { id: "sp-1", title: "My Weekend Mix", subtitle: "Spotify Playlist · 24 songs", thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80", trackCount: 24, tracks: LIKED_SONGS },
  { id: "sp-2", title: "Late Night Drive", subtitle: "Spotify Playlist · 38 songs", thumb: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&auto=format&fit=crop&q=80", trackCount: 38, tracks: LIKED_SONGS },
  { id: "sp-3", title: "Chill & Focus", subtitle: "Spotify Playlist · 55 songs", thumb: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=300&auto=format&fit=crop&q=80", trackCount: 55, tracks: LIKED_SONGS },
  { id: "sp-4", title: "Indie Discoveries", subtitle: "Spotify Playlist · 19 songs", thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&auto=format&fit=crop&q=80", trackCount: 19, tracks: LIKED_SONGS },
];

export const USER_FOLDERS: PlaylistFolder[] = [
  {
    id: "folder-1",
    name: "folder",
    subtitle: "Folder · 2 playlists",
    thumb: EYE_ARTWORK,
    playlists: [SPOTIFY_PLAYLISTS[0]!, SPOTIFY_PLAYLISTS[1]!],
  },
];
