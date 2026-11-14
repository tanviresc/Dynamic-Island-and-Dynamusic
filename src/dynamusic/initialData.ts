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
      durationMs: 267000,
      coverUrl: EYE_ARTWORK,
      streamUrl: "https://aac.saavncdn.com/166/71126f563b84a67f557fc94f1b2b489a_320.mp4",
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
      durationMs: 255000,
      coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://aac.saavncdn.com/279/c527f9264143e34d822ba01e952ef023_320.mp4",
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
      durationMs: 196000,
      coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://aac.saavncdn.com/393/6c9170b8e5ece8daba6b7a9c11e6d996_320.mp4",
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
      durationMs: 216000,
      coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://aac.saavncdn.com/831/d9fbdc754e365311a9457730161c8793_320.mp4",
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
      durationMs: 262000,
      coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=400&auto=format&fit=crop&q=80",
      streamUrl: "https://aac.saavncdn.com/587/4d0c3173479db73071cfbced18dadacf_320.mp4",
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
      durationMs: 266000,
      coverUrl: EYE_ARTWORK,
      streamUrl: "https://aac.saavncdn.com/254/6ebc38a6a7ea892f3a27cd66c71529d6_320.mp4",
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
    { id: "ch-1", title: "Summer", artist: "Calvin Harris", artistId: "calvin-harris", album: "Motion", durationMs: 201000, coverUrl: "https://c.saavncdn.com/728/Summer-Instrumental-2025-20250424101337-500x500.webp", streamUrl: "https://aac.saavncdn.com/728/5720ef6c220169dfdd55da7f9bd0125a_320.mp4", isLiked: true, verified: true },
    { id: "ch-2", title: "Feel So Close", artist: "Calvin Harris", artistId: "calvin-harris", album: "18 Months", durationMs: 196000, coverUrl: "https://c.saavncdn.com/393/Feel-So-Close-Instrumental-2026-20260826095554-500x500.webp", streamUrl: "https://aac.saavncdn.com/393/6c9170b8e5ece8daba6b7a9c11e6d996_320.mp4", isLiked: true, verified: true },
    { id: "ch-3", title: "One Kiss", artist: "Calvin Harris & Dua Lipa", artistId: "calvin-harris", album: "One Kiss", durationMs: 162000, coverUrl: "https://c.saavncdn.com/336/One-Kiss-x-Stereo-Love-Instrumental-2024-20260512112238-500x500.webp", streamUrl: "https://aac.saavncdn.com/336/3039d8437c21d3ab4cc0e819f55c9f13_320.mp4", isLiked: true, verified: true },
    { id: "ch-4", title: "This Is What You Came For", artist: "Calvin Harris & Rihanna", artistId: "calvin-harris", album: "This Is What You Came For", durationMs: 112000, coverUrl: "https://c.saavncdn.com/220/This-Is-What-You-Came-For-Instrumental-2024-20240909105110-500x500.webp", streamUrl: "https://aac.saavncdn.com/220/6c4df9fba471c3e7783fea7678fc687d_320.mp4", isLiked: false, verified: true },
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
    { id: "am-1", title: "Do I Wanna Know?", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "AM", durationMs: 262000, coverUrl: "https://c.saavncdn.com/587/do-i-wanna-know-Instrumental-2023-20231212101434-500x500.webp", streamUrl: "https://aac.saavncdn.com/587/4d0c3173479db73071cfbced18dadacf_320.mp4", isLiked: true, verified: true },
    { id: "am-2", title: "505", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "Favourite Worst Nightmare", durationMs: 253000, coverUrl: "https://c.saavncdn.com/858/Favourite-Worst-Nightmare-English-2007-20230426182106-500x500.webp", streamUrl: "https://aac.saavncdn.com/858/05bc60da91c79b1ae7ada03f9b301b1f_320.mp4", isLiked: true, verified: true },
    { id: "am-3", title: "R U Mine?", artist: "Arctic Monkeys", artistId: "arctic-monkeys", album: "AM", durationMs: 95000, coverUrl: "https://c.saavncdn.com/510/Ultra-Gaming-Mode-Vol-19-Instrumental-2026-20261002124750-500x500.webp", streamUrl: "https://aac.saavncdn.com/510/377022311cfc3bfcb5d68e53f87a70ab_320.mp4", isLiked: false, verified: true },
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
    { id: "ag-1", title: "7 rings", artist: "Ariana Grande", artistId: "ariana-grande", album: "thank u, next", durationMs: 278000, coverUrl: "https://c.saavncdn.com/219/Lullaby-Versions-of-Ariana-Grande-Instrumental-2021-20240726191058-500x500.webp", streamUrl: "https://aac.saavncdn.com/219/42f911132acdd549fd1224eb432dba7b_320.mp4", isLiked: true, verified: true },
    { id: "ag-2", title: "we can't be friends", artist: "Ariana Grande", artistId: "ariana-grande", album: "eternal sunshine", durationMs: 230000, coverUrl: "https://c.saavncdn.com/223/eternal-sunshine-deluxe-brighter-days-ahead-English-2025-20250328103556-500x500.webp", streamUrl: "https://aac.saavncdn.com/223/57199f8d3d90b2658ecf6ae9ce276b7a_320.mp4", isLiked: true, verified: true },
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
    coverUrl: "https://c.saavncdn.com/077/After-Hours-English-2020-20260804045014-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/077/0b02a92687d1ae3369b6859f44872e52_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-3",
    title: "I Want You Back",
    artist: "Jackson 5",
    artistId: "jackson-5",
    album: "Diana Ross Presents The Jackson 5",
    durationMs: 179000,
    coverUrl: "https://c.saavncdn.com/506/Hitsville-The-Making-Of-Motown-English-2019-20260917015018-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/506/f5d8c8aacfd596e7a8ff34acfff51278_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-4",
    title: "Billie Jean",
    artist: "Michael Jackson",
    artistId: "michael-jackson",
    album: "Thriller",
    durationMs: 293000,
    coverUrl: "https://c.saavncdn.com/409/Thriller-40-English-2022-20221117192431-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/409/f5e1006abf6ade9884fbd12d8af8aabc_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-5",
    title: "September",
    artist: "Earth, Wind & Fire",
    artistId: "earth-wind-fire",
    album: "The Best of Earth, Wind & Fire, Vol. 1",
    durationMs: 218000,
    coverUrl: "https://c.saavncdn.com/634/ZZang-KARAOKE-2024-Old-POP-Vol-132-Instrumental-2024-20260809070418-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/634/99aeb5c38042ddb0a7a1e20f2c801cee_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "jbi-6",
    title: "Gimme! Gimme! Gimme! (A Man After Midnight)",
    artist: "ABBA",
    artistId: "abba",
    album: "Voulez-Vous",
    durationMs: 292000,
    coverUrl: "https://c.saavncdn.com/168/ZZang-KARAOKE-2024-Old-POP-Vol-190-Instrumental-2024-20260713130638-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/168/3cbdfb0fd3bcc5cb9e6865a21685363a_320.mp4",
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
    coverUrl: "https://c.saavncdn.com/372/Starboy-English-2016-20261007033842-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/372/b7f9937fefd686876e90be4a96c9a6e9_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "liked-8",
    title: "Believer",
    artist: "Imagine Dragons",
    album: "Evolve",
    durationMs: 204000,
    coverUrl: "https://c.saavncdn.com/248/Evolve-English-2018-20260605220036-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/248/46944eb7b4b31f5b0abf5eb2e1be2d2a_320.mp4",
    source: "spotify",
    isLiked: true,
  },
  {
    id: "liked-9",
    title: "As It Was",
    artist: "Harry Styles",
    album: "Harry's House",
    durationMs: 167000,
    coverUrl: "https://c.saavncdn.com/061/Harry-s-House-English-2022-20220518224913-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/061/3cd80564e24ad83245334f8a0e7fb126_320.mp4",
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
