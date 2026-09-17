"""Patch OpenWakeWord's mmap cleanup for Windows' file locking behavior."""

from __future__ import annotations

import argparse
from pathlib import Path


DATA_OLD = """    # Remove old mmaped file\n    os.remove(mmap_path)\n\n    # Rename new mmap file to match original\n    os.rename(output_file2, mmap_path)\n"""
DATA_NEW = """    # Windows keeps memory-mapped files locked until all mappings are released.\n    mmap_file2.flush()\n    if hasattr(mmap_file1, \"_mmap\") and mmap_file1._mmap is not None:\n        mmap_file1._mmap.close()\n    if hasattr(mmap_file2, \"_mmap\") and mmap_file2._mmap is not None:\n        mmap_file2._mmap.close()\n    del mmap_file1\n    del mmap_file2\n\n    # os.replace is atomic and works after the Windows handles above are released.\n    os.replace(output_file2, mmap_path)\n"""
UTILS_OLD = """    # Trip empty rows from the mmapped array\n    trim_mmap(output_file)\n"""
UTILS_NEW = """    # Release this writer before trim_mmap replaces the file on Windows.\n    fp.flush()\n    if hasattr(fp, \"_mmap\") and fp._mmap is not None:\n        fp._mmap.close()\n    del fp\n\n    # Trim empty rows from the mmap array.\n    trim_mmap(output_file)\n"""
TRAIN_OLD = """        X_train = torch.utils.data.DataLoader(IterDataset(batch_generator),\n                                              batch_size=None, num_workers=n_cpus, prefetch_factor=16)\n"""
TRAIN_NEW = """        # Windows uses spawn for DataLoader workers. The locally defined transforms\n        # below cannot be pickled, so keep the training iterator in this process.\n        if os.name == \"nt\":\n            X_train = torch.utils.data.DataLoader(IterDataset(batch_generator), batch_size=None, num_workers=0)\n        else:\n            X_train = torch.utils.data.DataLoader(\n                IterDataset(batch_generator), batch_size=None, num_workers=n_cpus, prefetch_factor=16\n            )\n"""
VALIDATION_OLD = """        X_val_fp = np.load(config[\"false_positive_validation_data_path\"])\n        X_val_fp = np.array([X_val_fp[i:i+input_shape[0]] for i in range(0, X_val_fp.shape[0]-input_shape[0], 1)])  # reshape to match model\n"""
VALIDATION_NEW = """        X_val_fp = np.load(config[\"false_positive_validation_data_path\"])\n        # Generated validation features are already examples shaped as\n        # (n_examples, n_frames, n_features). Only raw frame streams need slicing.\n        if X_val_fp.ndim != 3:\n            X_val_fp = np.array([\n                X_val_fp[i:i+input_shape[0]] for i in range(0, X_val_fp.shape[0]-input_shape[0], 1)\n            ])\n"""
TFLITE_OLD = """        if args.convert_to_tflite:\n"""
TFLITE_NEW = """        # argparse's upstream default is a non-empty string, so use an explicit boolean check.\n        if args.convert_to_tflite is True:\n"""


def replace_once(path: Path, old: str, new: str) -> None:
    content = path.read_text(encoding="utf-8")
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f"Expected OpenWakeWord source block was not found: {path}")
    path.write_text(content.replace(old, new, 1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    package = args.source / "openwakeword"
    replace_once(package / "data.py", DATA_OLD, DATA_NEW)
    replace_once(package / "utils.py", UTILS_OLD, UTILS_NEW)
    replace_once(package / "train.py", TRAIN_OLD, TRAIN_NEW)
    replace_once(package / "train.py", VALIDATION_OLD, VALIDATION_NEW)
    replace_once(package / "train.py", TFLITE_OLD, TFLITE_NEW)
    print("Applied OpenWakeWord Windows compatibility patches.")


if __name__ == "__main__":
    main()
