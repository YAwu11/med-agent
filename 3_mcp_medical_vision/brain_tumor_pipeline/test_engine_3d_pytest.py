import sys
import types
from pathlib import Path

import nibabel as nib
import numpy as np

import engine_3d


def _write_nifti(path: Path, value: float) -> None:
    data = np.full((8, 9, 10), value, dtype=np.float32)
    image = nib.Nifti1Image(data, np.diag([1.0, 2.0, 3.0, 1.0]))
    nib.save(image, path)


def test_step1_segment_uses_nnunet_predictor_when_model_and_modalities_exist(tmp_path, monkeypatch) -> None:
    case_dir = tmp_path / "case"
    case_dir.mkdir()

    _write_nifti(case_dir / "t1.nii.gz", 1.0)
    _write_nifti(case_dir / "t1ce.nii.gz", 2.0)
    _write_nifti(case_dir / "t2.nii.gz", 3.0)
    _write_nifti(case_dir / "flair.nii.gz", 4.0)

    model_output_dir = tmp_path / "models" / "Dataset002_BRATS19" / "nnUNetTrainer__nnUNetPlans__3d_fullres"
    model_output_dir.mkdir(parents=True)
    (model_output_dir / "dataset.json").write_text("{}", encoding="utf-8")
    (model_output_dir / "plans.json").write_text("{}", encoding="utf-8")
    (model_output_dir / "fold_0").mkdir()

    calls: dict[str, object] = {}

    class FakePredictor:
        def __init__(self, *args, **kwargs):
            calls["predictor_init"] = kwargs

        def initialize_from_trained_model_folder(self, model_training_output_dir, use_folds, checkpoint_name="checkpoint_final.pth"):
            calls["model_training_output_dir"] = model_training_output_dir
            calls["use_folds"] = use_folds
            calls["checkpoint_name"] = checkpoint_name

        def predict_single_npy_array(
            self,
            input_image,
            image_properties,
            segmentation_previous_stage=None,
            output_file_truncated=None,
            save_or_return_probabilities=False,
        ):
            calls["input_shape"] = tuple(input_image.shape)
            calls["spacing"] = tuple(image_properties["spacing"])
            result = np.zeros(input_image.shape[1:], dtype=np.uint8)
            result[2:5, 3:6, 1:4] = 4
            return result

    fake_root = types.ModuleType("nnunetv2")
    fake_inference = types.ModuleType("nnunetv2.inference")
    fake_predict_from_raw_data = types.ModuleType("nnunetv2.inference.predict_from_raw_data")
    fake_predict_from_raw_data.nnUNetPredictor = FakePredictor

    monkeypatch.setitem(sys.modules, "nnunetv2", fake_root)
    monkeypatch.setitem(sys.modules, "nnunetv2.inference", fake_inference)
    monkeypatch.setitem(sys.modules, "nnunetv2.inference.predict_from_raw_data", fake_predict_from_raw_data)
    monkeypatch.setattr(engine_3d, "NNUNET_MODEL_DIR", model_output_dir)

    mask, is_mock = engine_3d.step1_segment(str(case_dir))

    assert is_mock is False
    assert calls["model_training_output_dir"] == str(model_output_dir)
    assert calls["checkpoint_name"] == "checkpoint_final.pth"
    assert calls["input_shape"] == (4, 10, 9, 8)
    assert calls["spacing"] == (3.0, 2.0, 1.0)
    assert mask.shape == (8, 9, 10)
    assert int(mask.max()) == 4