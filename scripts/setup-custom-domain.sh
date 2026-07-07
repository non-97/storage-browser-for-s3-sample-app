#!/usr/bin/env bash
#
# Amplify Hosting のカスタムドメインを AWS CLI で冪等にセットアップする。
#
# - 何度実行しても同じ状態に収束する (存在確認してから作成する)。
# - 同一アカウントの Route53 なので、検証レコード/本番レコードは Amplify が自動作成する。
#   予約用に残っているダミー A レコードだけ、事前に削除する (CNAME と衝突するため)。
#
# 事前準備: awsume 等で AWS 認証済みにしておくこと (aws sts get-caller-identity が通る状態)。
#
# 使い方 (横展開を想定し、環境固有値はデフォルトを持たない。環境変数で必ず指定する):
#   APP_ID=<AmplifyアプリID> \
#   DOMAIN_NAME=<フロントのFQDN> \
#   HOSTED_ZONE_ID=<Route53ホストゾーンID> \
#   ./scripts/setup-custom-domain.sh
#
set -euo pipefail

# ===== 設定 =====
# 環境固有値 (必須。未指定ならエラーで止まる)
APP_ID="${APP_ID:?環境変数 APP_ID を指定してください (Amplify アプリの ID。aws amplify list-apps で確認)}"
DOMAIN_NAME="${DOMAIN_NAME:?環境変数 DOMAIN_NAME を指定してください (フロントのカスタムドメイン FQDN)}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:?環境変数 HOSTED_ZONE_ID を指定してください (Route53 ホストゾーン ID)}"
# 環境に依存しない値 (上書き可)
APP_REGION="${APP_REGION:-ap-northeast-1}"
BRANCH_NAME="${BRANCH_NAME:-main}"

log() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }

aws sts get-caller-identity >/dev/null

log "対象"
echo "app-id : ${APP_ID} (${APP_REGION})"
echo "domain : ${DOMAIN_NAME} -> branch ${BRANCH_NAME}"

# ============================================================
# 1. Route53 のダミー A レコードを削除 (冪等)
#    予約用として置かれた A レコード が残っていると、
#    Amplify が作る CNAME と衝突するため削除する。無ければ何もしない。
# ============================================================
log "1. Route53 ダミー A レコードの掃除"
REC=$(aws route53 list-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${DOMAIN_NAME}.' && Type=='A' && AliasTarget==\`null\`].[TTL,ResourceRecords[0].Value]" \
  --output text)
if [ -n "$REC" ] && [ "$REC" != "None" ]; then
  REC_TTL="$(printf '%s\n' "$REC" | head -1 | cut -f1)"
  REC_VAL="$(printf '%s\n' "$REC" | head -1 | cut -f2)"
  echo "削除: ${DOMAIN_NAME} A ${REC_VAL} (TTL ${REC_TTL})"
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{\"Changes\":[{\"Action\":\"DELETE\",\"ResourceRecordSet\":{\"Name\":\"${DOMAIN_NAME}\",\"Type\":\"A\",\"TTL\":${REC_TTL},\"ResourceRecords\":[{\"Value\":\"${REC_VAL}\"}]}}]}" \
    --query "ChangeInfo.Status" --output text
else
  echo "ダミー A レコードなし (スキップ)"
fi

# ============================================================
# 2. カスタムドメインの関連付け (冪等)
#    既に関連付け済みなら作成しない。空 prefix = ドメインのルートを branch に割り当て。
# ============================================================
log "2. カスタムドメインの関連付け"
if aws amplify get-domain-association \
  --app-id "$APP_ID" --domain-name "$DOMAIN_NAME" --region "$APP_REGION" \
  --query "domainAssociation.domainStatus" --output text 2>/dev/null; then
  echo "既に関連付け済み (スキップ)。上の値が現在のステータス"
else
  echo "新規に関連付け"
  aws amplify create-domain-association \
    --app-id "$APP_ID" --domain-name "$DOMAIN_NAME" --region "$APP_REGION" \
    --sub-domain-settings "[{\"prefix\":\"\",\"branchName\":\"${BRANCH_NAME}\"}]" \
    --query "domainAssociation.domainStatus" --output text
fi

# ============================================================
# 3. 状態の確認
# ============================================================
log "3. 結果"
aws amplify get-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN_NAME" --region "$APP_REGION" \
  --query "domainAssociation.{status:domainStatus,statusReason:statusReason,cert:certificate.type}" --output table

log "完了"
echo "証明書検証と配信反映に数分〜30分かかります。"
echo "ステータスが AVAILABLE になれば https://${DOMAIN_NAME} でアクセスできます。"
