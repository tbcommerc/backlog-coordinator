"""Owned native runtime preparation/cleanup only; inference is forbidden."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import runpy
import time
from uuid import uuid4


async def qualify(image, output):
    from bridge.model import ModelBroker
    from bridge.tools import ToolBridge
    from contracts.models import Answer
    from fixtures.data import FakeData
    from runtime.docker import DockerLauncher
    from runtime.opencode import OpenCodeRuntime
    from dmb_agent_contracts.entry import prepare_runtime
    from dmb_agent_contracts.operation import operation_scope
    root=Path(__file__).resolve().parents[1]
    namespace='runtime-start-'+uuid4().hex
    os.environ.update(DMB_AGENT_SERVICE_ID='backlog-assistant',DMB_AGENT_LIMITER_MODE='standalone',
        DMB_AGENT_LIMITER_REDIS_URL='redis://127.0.0.1:62152/0',DMB_AGENT_LIMITER_NAMESPACE=namespace,
        DMB_AGENT_LIMITER_STATE_DIR=str(root/'.runtime/agent-limiter'/namespace))
    prepare_runtime()
    data=FakeData()
    execution=data.register('synthetic-runtime-prepare')
    grant=await data.activate(execution,'synthetic-owned-controller')
    bridge=ToolBridge(data,execution,grant,await data.catalog(execution,grant),deadline=time.monotonic()+60)
    def forbidden(*args,**kwargs):
        raise RuntimeError('inference_forbidden_in_startup_qualification')
    ModelBroker.completion=forbidden
    state=output.parent/'runtime-state'
    launcher=DockerLauncher(state,'https://opencode.ai/zen/go/v1','synthetic-not-a-provider-key',image)
    runtime=OpenCodeRuntime(launcher,model='synthetic')
    report={'scope':'local_runtime_prepare_only','model_calls':0,'image':image,'status':'NOT_RUN'}
    started=time.monotonic()
    with operation_scope(run_id=uuid4()) as context:
        token=context.hold_slot_for_cleanup()
        handle=None
        try:
            handle=await asyncio.wait_for(runtime.prepare({'execution_ref':execution},bridge,Answer.model_json_schema()),55)
            report.update(status='PASS',prepare_seconds=round(time.monotonic()-started,3))
        except Exception as error:
            chain=[]
            while error is not None and len(chain)<5:
                chain.append(type(error).__name__)
                error=error.__context__
            report.update(status='FAIL',error_chain=chain,
                runtime_exit_code=getattr(launcher,'start_exit_code',None),
                diagnostic=getattr(launcher,'start_diagnostic',''))
        finally:
            await data.revoke(execution,grant)
            if handle is not None:
                try:
                    await runtime.dispose(handle)
                except Exception as error:
                    report.update(status='FAIL',initial_cleanup_error=type(error).__name__)
            try:
                cleanup=runpy.run_path(str(root/'scripts/replay-agent-products.py'))['cleanup_owned_runtime']
                cleanup(state,image)
                # The Docker resources are now positively absent. Close any
                # remaining owned broker/server tasks before releasing the slot.
                from runtime.local_probe import LocalProbeLauncher
                for instance in list(launcher.instances):
                    await LocalProbeLauncher.destroy(launcher,instance)
                context.confirm_cleanup(token)
                report['owned_cleanup']='confirmed'
            except Exception as error:
                report.update(status='FAIL',owned_cleanup='unconfirmed',cleanup_error=type(error).__name__)
            report['elapsed_seconds']=round(time.monotonic()-started,3)
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--image',required=True)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if not re.fullmatch('sha256:[a-f0-9]{64}',args.image):
        parser.error('immutable local image required')
    if args.output.exists() or not args.output.resolve().is_relative_to(root/'.runtime'):
        parser.error('new workspace evidence required')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    asyncio.run(qualify(args.image,args.output.resolve()))


if __name__=='__main__':
    main()
