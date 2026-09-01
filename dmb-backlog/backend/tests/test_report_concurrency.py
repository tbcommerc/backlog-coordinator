import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.pool import StaticPool

from models import EventOutbox, Report


def test_report_mapper_rejects_lost_update():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Report.__table__.create(engine)
    EventOutbox.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    seed = Session()
    report = Report(name="Shared", type="custom", version=0)
    seed.add(report)
    seed.commit()
    report_id = report.id
    seed.close()

    first = Session()
    second = Session()
    first_report = first.get(Report, report_id)
    second_report = second.get(Report, report_id)
    first_report.name = "First"
    first_report.version += 1
    first.commit()

    second_report.name = "Second"
    second_report.version += 1
    with pytest.raises(StaleDataError):
        second.commit()
    second.rollback()

    verify = Session()
    assert verify.get(Report, report_id).name == "First"
    assert verify.get(Report, report_id).version == 1
    engine.dispose()
