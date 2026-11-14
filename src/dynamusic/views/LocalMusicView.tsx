import React, { useRef } from "react";
import { Music2, Upload, Play } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";

export const LocalMusicView: React.FC = () => {
  const { queue, playTrack, addLocalFiles } = useDynamusic();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const localTracks = queue.filter((t) => t.source === "local");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addLocalFiles(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addLocalFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="pb-16 select-none" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {/* Hero */}
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-[#d97706]/30 to-transparent">
        <div className="w-48 h-48 rounded-xl bg-[#d97706]/90 flex items-center justify-center shrink-0 shadow-2xl">
          <Music2 className="w-24 h-24 text-white" />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-bold text-amber-400 uppercase tracking-wider">
            Local Device
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            Local Music
          </h1>
          <div className="text-[13.5px] font-medium text-white/80">
            {localTracks.length} local files loaded
          </div>
        </div>
      </div>

      {/* File Dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="p-8 border-2 border-dashed border-white/20 hover:border-white/40 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors flex flex-col items-center justify-center gap-3 mb-8 text-center"
      >
        <Upload className="w-8 h-8 text-white/50" />
        <div>
          <div className="text-[15px] font-bold text-white">Drop audio files here or click to browse</div>
          <div className="text-[12.5px] text-white/45 mt-1">Supports MP3, FLAC, WAV, M4A, AAC, OGG</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Tracklist if files added */}
      {localTracks.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[16px] font-bold text-white mb-3">Loaded tracks</h3>
          {localTracks.map((t, idx) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => playTrack(t, localTracks)}
              className="group flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-white/[0.06] cursor-pointer transition-colors"
            >
              <span className="w-6 text-center text-white/50 text-[13px]">{idx + 1}</span>
              <img src={t.coverUrl} alt="" className="w-10 h-10 rounded object-cover" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white truncate">{t.title}</div>
                <div className="text-[12px] text-white/50 truncate">{t.artist}</div>
              </div>
              <Play className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

