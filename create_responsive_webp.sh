#!/bin/bash

IMAGE_DIR="public/images"
# Ensure this list matches your original PNG filenames without the .png extension
BASE_IMAGES=(
    "tekonurmi_map_kentta_a"
    "tekonurmi_map_kentta_b"
    "tekonurmi_map_kentta_c"
    "tekonurmi_map_kentta_d"
    "garam_masala_map_kentta_1a"
    "garam_masala_map_kentta_1b"
    "garam_masala_map_kentta_1c"
    "garam_masala_map_kentta_1d"
    "garam_masala_map_kentta_2a"
    "garam_masala_map_kentta_2b"
    "garam_masala_map_kentta_2c"
    "garam_masala_map_kentta_2d"
    "nurmi_map_kentta_4a"
    "nurmi_map_kentta_4b"
    "nurmi_map_kentta_4c"
    "nurmi_map_kentta_4d"
    "heinapaan_halli_map_kentta_a"
    "heinapaan_halli_map_kentta_b"
    "heinapaan_halli_map_kentta_c"
    "heinapaan_halli_map_kentta_d"
)

TARGET_WIDTHS=(336 504 672)
WEBP_QUALITY=80 # Adjust quality (0-100), higher is better quality/larger file

mkdir -p "$IMAGE_DIR"

for base_name in "${BASE_IMAGES[@]}"; do
    input_png="${IMAGE_DIR}/${base_name}.png"

    if [ ! -f "$input_png" ]; then
        echo "Warning: Source PNG $input_png not found. Skipping."
        continue
    fi

    echo "Processing $input_png..."

    for width in "${TARGET_WIDTHS[@]}"; do
        output_webp="${IMAGE_DIR}/${base_name}-${width}w.webp"
        echo "  Generating $output_webp (width: ${width}px, quality: ${WEBP_QUALITY})"
        
        # Resize and convert to lossy WebP with specified quality
        magick "$input_png" -resize "${width}x" -quality "$WEBP_QUALITY" "$output_webp"
        
        if [ $? -eq 0 ]; then
            echo "    Successfully created $output_webp"
        else
            echo "    Error creating $output_webp"
        fi
    done
done

echo "Responsive WebP image generation complete."
