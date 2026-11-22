// Small canvas helper that takes a source image + a pixel crop area
// (as reported by react-easy-crop) and returns a Blob you can upload.

const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (err) => reject(err));
    image.setAttribute('crossOrigin', 'anonymous'); // avoids canvas tainting for remote URLs
    image.src = url;
  });

/**
 * @param {string} imageSrc - object URL / data URL of the source image
 * @param {{x:number,y:number,width:number,height:number}} pixelCrop - from react-easy-crop's onCropComplete
 * @param {number} outputSize - final square output size in px (default 512)
 * @returns {Promise<Blob>} JPEG blob ready to upload
 */
export default async function getCroppedImg(imageSrc, pixelCrop, outputSize = 512) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  // Draw only the cropped region, scaled to fill the square output canvas
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas is empty'));
        resolve(blob);
      },
      'image/jpeg',
      0.92
    );
  });
}