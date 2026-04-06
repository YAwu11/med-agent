from app.gateway.services import analyzer_registry
from app.gateway.services.analyzers import register_all


def test_register_all_routes_brain_mri_to_notice_analyzer() -> None:
    analyzer_registry._registry.clear()

    register_all()

    analyzers = analyzer_registry.get_analyzers_for("brain_mri", 0.95)

    assert analyzers
    assert analyzers[0].name == "brain_mri_notice"