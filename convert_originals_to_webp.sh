#!/bin/bash

IMAGE_DIR="public/images"

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

mkdir -p "$IMAGE_DIR"

for base_name in "${BASE_IMAGES[@]}"; do
    input_png="${IMAGE_DIR}/${base_name}.png"
    output_webp="${IMAGE_DIR}/${base_name}.webp"

    if [ ! -f "$input_png" ]; then
        echo "Warning: Source PNG $input_png not found. Skipping."
        continue
    fi

    echo "Converting $input_png to $output_webp (lossless WebP)..."
    magick "$input_png" -define webp:lossless=true "$output_webp"
    
    if [ $? -eq 0 ]; then
        echo "  Successfully created $output_webp"
    else
        echo "  Error creating $output_webp"
    fi
done

echo "WebP conversion for original images complete."
