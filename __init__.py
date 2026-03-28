from .node import Comfy3DStudioNode, Comfy3DTextureSplitterNode

NODE_CLASS_MAPPINGS = {
    "Comfy3D-Studio": Comfy3DStudioNode,
    "Comfy3D-Texture-Splitter": Comfy3DTextureSplitterNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Comfy3D-Studio": "Comfy3D-Studio",
    "Comfy3D-Texture-Splitter": "Comfy3D Texture Splitter"
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
