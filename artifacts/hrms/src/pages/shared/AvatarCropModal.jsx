import { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, Upload, Loader2, ImagePlus } from 'lucide-react';
import getCroppedImg from '../../store/slices/cropImage';
// import { getCroppedImg } from '../../store/slices/cropImage';

/**
 * Facebook/Instagram-style avatar picker:
 *  1. User picks a file -> we show it in a circular cropper (react-easy-crop)
 *  2. User drags to reposition / uses the zoom slider
 *  3. "Save" crops it on a canvas, hands the Blob to onSave(blob)
 *
 * Usage:
 *   <AvatarCropModal
 *     isOpen={showAvatarModal}
 *     onClose={() => setShowAvatarModal(false)}
 *     onSave={async (blob) => { await employeeAPI.uploadAvatar(userId, blob); }}
 *   />
 */
export default function AvatarCropModal({ isOpen, onClose, onSave }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const resetState = () => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setSaving(false);
    setError('');
  };

  const handleClose = () => {
    if (saving) return;
    resetState();
    onClose();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5MB.');
      return;
    }

    setError('');
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result);
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_croppedArea, croppedAreaPixelsValue) => {
    setCroppedAreaPixels(croppedAreaPixelsValue);
  }, []);

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    setError('');
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      await onSave(blob);
      resetState();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to upload photo. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="glass-card w-full max-w-md overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="font-display text-base font-bold text-white">
                {imageSrc ? 'Edit Photo' : 'Upload Profile Picture'}
              </h3>
              <button
                onClick={handleClose}
                disabled={saving}
                className="w-7 h-7 rounded-full flex-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              {!imageSrc ? (
                // ── Empty state: pick a file ────────────────────────────
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square rounded-2xl border-2 border-dashed border-white/15 hover:border-primary-500/50 hover:bg-white/5 transition-colors flex flex-col items-center justify-center gap-3 text-slate-400"
                >
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex-center shadow-glow-primary">
                    <ImagePlus className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-white">Click to choose a photo</p>
                    <p className="text-[11px] text-slate-500 mt-1">JPG or PNG, up to 5MB</p>
                  </div>
                </button>
              ) : (
                // ── Cropper ──────────────────────────────────────────────
                <>
                  <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-surface-950">
                    <Cropper
                      image={imageSrc}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                    />
                  </div>

                  {/* Zoom slider */}
                  <div className="flex items-center gap-3 mt-4">
                    <ZoomIn className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full accent-primary-500"
                    />
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors mt-3 disabled:opacity-50"
                  >
                    Choose a different photo
                  </button>
                </>
              )}

              {error && <p className="text-xs text-danger-400 mt-3">{error}</p>}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Footer */}
            {imageSrc && (
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
                <button onClick={handleClose} disabled={saving} className="btn-secondary text-xs">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !croppedAreaPixels}
                  className={`btn-primary text-xs ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Save Photo
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}