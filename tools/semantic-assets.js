const base = 'https://hf-mirror.com/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/'
const asset = (id, path, bytes, sha256) => ({ id, path, bytes, sha256, url: base + path.replace('public/models/onnx-community/siglip2-base-patch16-224-ONNX/', '') })
export const semanticAssets = Object.freeze([
  asset('siglip2-config', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/config.json', 435, 'E43A9F7692D3819886A82CB2097048258D444F123C67D37EC825F9345B019CF2'),
  asset('siglip2-preprocessor', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/preprocessor_config.json', 394, '9B36B57EBAF20F09BF4C22100CCC21877EA6BFE5AEAD0C00C59F8AF8CCEFACFC'),
  asset('siglip2-special-tokens', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/special_tokens_map.json', 636, 'BAEC30EA10906F16ADB8C18AF7A34023002C1746542612B8B41C9F09E1351351'),
  asset('siglip2-tokenizer', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/tokenizer.json', 34363039, 'CB9140FAE3AC5122C972D37ADF83E1248471A38147AD76F8215C8872C6FD8322'),
  asset('siglip2-tokenizer-model', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/tokenizer.model', 4241003, '61A7B147390C64585D6C3543DD6FC636906C9AF3865A5548F27F31AEE1D4C8E2'),
  asset('siglip2-onnx', 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/onnx/model_quantized.onnx', 378000135, '87FB1DBB1C091EA083E71A6C6A92FB2A39DD360EF1415314D9D645CA2B22057D'),
])
