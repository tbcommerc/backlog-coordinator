from meeting_analyzer.config import Settings


def test_service_working_directory_profile(tmp_path, monkeypatch):
    for aliases in Settings.alias_specs.values():
        for name in aliases:
            monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / '.env').write_text(
        'MEETING_ANALYZER_DATABASE_URL=postgresql+psycopg://synthetic/meeting\n'
        'MEETING_ANALYZER_SERVICE_SECRET=synthetic-service-secret\n'
        'MEETING_ANALYZER_MODEL_API_KEY=synthetic-model-key\n',
        encoding='utf-8',
    )
    settings = Settings()
    settings.validate_runtime()
    assert settings.service_secret.get_secret_value() == 'synthetic-service-secret'
    assert settings.configuration_sources()['service_secret']['source'] == 'service_file'
    monkeypatch.setenv('MEETING_ANALYZER_SERVICE_SECRET', 'synthetic-override')
    assert Settings().service_secret.get_secret_value() == 'synthetic-override'
